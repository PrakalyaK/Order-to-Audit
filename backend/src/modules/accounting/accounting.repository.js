import { query } from '../../config/db.js';
import { roundMoney, JOURNAL_ENTRY_STATUS } from './accounting.constants.js';

class AccountingRepository {
  // ============================================================================
  // 1. CHART OF ACCOUNTS
  // ============================================================================

  async findAllAccounts(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.account_type) {
      values.push(filters.account_type);
      conditions.push(`account_type = $${values.length}`);
    }

    if (filters.category) {
      values.push(filters.category);
      conditions.push(`category = $${values.length}`);
    }

    if (filters.is_active !== undefined) {
      values.push(filters.is_active === 'true' || filters.is_active === true);
      conditions.push(`is_active = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT 
        id,
        account_code,
        account_name,
        account_type,
        category,
        normal_balance,
        parent_account_id,
        description,
        is_system,
        is_active,
        created_at,
        updated_at
      FROM chart_of_accounts
      ${whereClause}
      ORDER BY account_code ASC
    `;

    const result = await db.query(sql, values);
    return result.rows;
  }

  async findAccountById(id, client = null) {
    const db = client || { query };
    const result = await db.query(
      `SELECT * FROM chart_of_accounts WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async findAccountByCode(code, client = null) {
    const db = client || { query };
    const result = await db.query(
      `SELECT * FROM chart_of_accounts WHERE account_code = $1`,
      [code]
    );
    return result.rows[0] || null;
  }

  async createAccount(data, client = null) {
    const db = client || { query };
    const result = await db.query(
      `INSERT INTO chart_of_accounts (
        account_code,
        account_name,
        account_type,
        category,
        normal_balance,
        parent_account_id,
        description,
        is_system,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        data.account_code,
        data.account_name,
        data.account_type,
        data.category,
        data.normal_balance,
        data.parent_account_id || null,
        data.description || null,
        data.is_system || false,
        data.is_active !== undefined ? data.is_active : true,
      ]
    );
    return result.rows[0];
  }

  async updateAccount(id, data, client = null) {
    const db = client || { query };
    const fields = [];
    const values = [];

    if (data.account_name !== undefined) {
      values.push(data.account_name);
      fields.push(`account_name = $${values.length}`);
    }
    if (data.category !== undefined) {
      values.push(data.category);
      fields.push(`category = $${values.length}`);
    }
    if (data.description !== undefined) {
      values.push(data.description);
      fields.push(`description = $${values.length}`);
    }
    if (data.is_active !== undefined) {
      values.push(data.is_active);
      fields.push(`is_active = $${values.length}`);
    }

    if (fields.length === 0) {
      return this.findAccountById(id, client);
    }

    values.push(id);
    const sql = `
      UPDATE chart_of_accounts
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await db.query(sql, values);
    return result.rows[0] || null;
  }

  // ============================================================================
  // 2. JOURNAL ENTRIES & SEQUENTIAL NUMBERING
  // ============================================================================

  async generateEntryNumber(entryDate, client = null) {
    const db = client || { query };
    const dateObj = entryDate ? new Date(entryDate) : new Date();
    const year = dateObj.getFullYear();
    const prefix = `JE-${year}-`;

    const res = await db.query(
      `SELECT entry_number 
       FROM journal_entries 
       WHERE entry_number LIKE $1 
       ORDER BY entry_number DESC 
       LIMIT 1 FOR UPDATE`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].entry_number.match(/\d+$/);
      if (match) {
        nextSeq = parseInt(match[0], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  async createEntry(header, lines, client) {
    const db = client || { query };

    const entryRes = await db.query(
      `INSERT INTO journal_entries (
        entry_number,
        entry_date,
        accounting_date,
        source_type,
        source_id,
        source_reference,
        narration,
        total_debit,
        total_credit,
        status,
        posted_at,
        posted_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        header.entry_number,
        header.entry_date,
        header.accounting_date || header.entry_date,
        header.source_type,
        header.source_id || null,
        header.source_reference || null,
        header.narration,
        header.total_debit,
        header.total_credit,
        header.status || JOURNAL_ENTRY_STATUS.POSTED,
        header.status === JOURNAL_ENTRY_STATUS.POSTED ? new Date() : null,
        header.posted_by,
      ]
    );

    const entry = entryRes.rows[0];

    const insertedLines = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const lineRes = await db.query(
        `INSERT INTO journal_entry_lines (
          journal_entry_id,
          account_id,
          line_number,
          debit_amount,
          credit_amount,
          description,
          party_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          entry.id,
          l.account_id,
          i + 1,
          roundMoney(l.debit_amount || 0),
          roundMoney(l.credit_amount || 0),
          l.description || null,
          l.party_id || null,
        ]
      );
      insertedLines.push(lineRes.rows[0]);
    }

    return {
      ...entry,
      lines: insertedLines,
    };
  }

  async postEntry(id, userId, client = null) {
    const db = client || { query };
    await db.query(`SELECT fn_post_journal_entry($1, $2)`, [id, userId]);
    return this.findEntryById(id, client);
  }

  async reverseEntry(id, userId, reason, client = null) {
    const db = client || { query };
    const res = await db.query(
      `SELECT fn_reverse_journal_entry($1, $2, $3) AS reversal_entry_id`,
      [id, userId, reason]
    );
    const reversalId = res.rows[0].reversal_entry_id;
    return this.findEntryById(reversalId, client);
  }

  async findEntryById(id, client = null) {
    const db = client || { query };
    const entryRes = await db.query(
      `SELECT 
        je.*,
        u_post.username AS posted_by_username,
        u_rev.username AS reversed_by_username
      FROM journal_entries je
      LEFT JOIN users u_post ON je.posted_by = u_post.id
      LEFT JOIN users u_rev ON je.reversed_by = u_rev.id
      WHERE je.id = $1`,
      [id]
    );

    if (entryRes.rows.length === 0) return null;
    const entry = entryRes.rows[0];

    const linesRes = await db.query(
      `SELECT 
        jel.*,
        coa.account_code,
        coa.account_name,
        coa.account_type,
        coa.normal_balance,
        p.trade_name AS party_name,
        p.legal_name AS party_legal_name
      FROM journal_entry_lines jel
      JOIN chart_of_accounts coa ON jel.account_id = coa.id
      LEFT JOIN parties p ON jel.party_id = p.id
      WHERE jel.journal_entry_id = $1
      ORDER BY jel.line_number ASC`,
      [id]
    );

    return {
      ...entry,
      lines: linesRes.rows,
    };
  }

  async findEntryBySource(sourceType, sourceId, client = null) {
    const db = client || { query };
    const res = await db.query(
      `SELECT id FROM journal_entries 
       WHERE source_type = $1 AND source_id = $2 AND status = 'posted'
       LIMIT 1`,
      [sourceType, sourceId]
    );
    if (res.rows.length === 0) return null;
    return this.findEntryById(res.rows[0].id, client);
  }

  async findAllEntries(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`je.status = $${values.length}`);
    }

    if (filters.source_type) {
      values.push(filters.source_type);
      conditions.push(`je.source_type = $${values.length}`);
    }

    if (filters.from_date) {
      values.push(filters.from_date);
      conditions.push(`je.entry_date >= $${values.length}`);
    }

    if (filters.to_date) {
      values.push(filters.to_date);
      conditions.push(`je.entry_date <= $${values.length}`);
    }

    if (filters.account_id) {
      values.push(filters.account_id);
      conditions.push(`EXISTS (SELECT 1 FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id AND jel.account_id = $${values.length})`);
    }

    if (filters.party_id) {
      values.push(filters.party_id);
      conditions.push(`EXISTS (SELECT 1 FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id AND jel.party_id = $${values.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM journal_entries je ${whereClause}`,
      values
    );
    const total = countRes.rows[0].total;

    const limit = parseInt(filters.limit, 10) || 20;
    const page = parseInt(filters.page, 10) || 1;
    const offset = (page - 1) * limit;

    values.push(limit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const sql = `
      SELECT 
        je.*,
        u.username AS posted_by_username,
        (SELECT COUNT(*)::int FROM journal_entry_lines WHERE journal_entry_id = je.id) AS line_count
      FROM journal_entries je
      LEFT JOIN users u ON je.posted_by = u.id
      ${whereClause}
      ORDER BY je.entry_date DESC, je.entry_number DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const rowsRes = await db.query(sql, values);

    return {
      entries: rowsRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  // ============================================================================
  // 3. GENERAL LEDGER & STATUTORY REPORTING
  // ============================================================================

  async getGeneralLedger(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.account_id) {
      values.push(filters.account_id);
      conditions.push(`account_id = $${values.length}`);
    }

    if (filters.account_code) {
      values.push(filters.account_code);
      conditions.push(`account_code = $${values.length}`);
    }

    if (filters.party_id) {
      values.push(filters.party_id);
      conditions.push(`party_id = $${values.length}`);
    }

    if (filters.from_date) {
      values.push(filters.from_date);
      conditions.push(`entry_date >= $${values.length}`);
    }

    if (filters.to_date) {
      values.push(filters.to_date);
      conditions.push(`entry_date <= $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT 
        line_id,
        journal_entry_id,
        entry_number,
        entry_date,
        accounting_date,
        source_type,
        source_id,
        source_reference,
        entry_status,
        account_id,
        account_code,
        account_name,
        account_type,
        category,
        normal_balance,
        line_number,
        debit_amount,
        credit_amount,
        net_line_amount,
        line_description,
        narration,
        party_id,
        party_name,
        created_at
      FROM v_general_ledger
      ${whereClause}
      ORDER BY entry_date ASC, entry_number ASC, line_number ASC
    `;

    const result = await db.query(sql, values);
    return result.rows;
  }

  async getTrialBalance(filters = {}, client = null) {
    const db = client || { query };

    // If date filters are provided, calculate dynamically from posted journal lines
    if (filters.from_date || filters.to_date || filters.as_of_date) {
      const conditions = ["je.status = 'posted'"];
      const values = [];

      if (filters.as_of_date) {
        values.push(filters.as_of_date);
        conditions.push(`je.entry_date <= $${values.length}`);
      } else {
        if (filters.from_date) {
          values.push(filters.from_date);
          conditions.push(`je.entry_date >= $${values.length}`);
        }
        if (filters.to_date) {
          values.push(filters.to_date);
          conditions.push(`je.entry_date <= $${values.length}`);
        }
      }

      const whereClause = conditions.join(' AND ');

      const sql = `
        SELECT 
          coa.id AS account_id,
          coa.account_code,
          coa.account_name,
          coa.account_type,
          coa.category,
          coa.normal_balance,
          COALESCE(SUM(jel.debit_amount), 0.00) AS total_debit,
          COALESCE(SUM(jel.credit_amount), 0.00) AS total_credit,
          CASE 
            WHEN COALESCE(SUM(jel.debit_amount), 0.00) >= COALESCE(SUM(jel.credit_amount), 0.00) 
            THEN ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2)
            ELSE 0.00
          END AS net_debit_balance,
          CASE 
            WHEN COALESCE(SUM(jel.credit_amount), 0.00) > COALESCE(SUM(jel.debit_amount), 0.00) 
            THEN ROUND(COALESCE(SUM(jel.credit_amount), 0.00) - COALESCE(SUM(jel.debit_amount), 0.00), 2)
            ELSE 0.00
          END AS net_credit_balance
        FROM chart_of_accounts coa
        LEFT JOIN (
          SELECT jel_sub.* 
          FROM journal_entry_lines jel_sub
          JOIN journal_entries je ON jel_sub.journal_entry_id = je.id
          WHERE ${whereClause}
        ) jel ON coa.id = jel.account_id
        WHERE coa.is_active = true
        GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.category, coa.normal_balance
        ORDER BY coa.account_code ASC
      `;

      const result = await db.query(sql, values);
      return result.rows;
    }

    const result = await db.query(`SELECT * FROM v_trial_balance ORDER BY account_code ASC`);
    return result.rows;
  }

  async getProfitAndLoss(filters = {}, client = null) {
    const db = client || { query };

    if (filters.from_date || filters.to_date || filters.as_of_date) {
      const conditions = ["je.status = 'posted'"];
      const values = [];

      if (filters.as_of_date) {
        values.push(filters.as_of_date);
        conditions.push(`je.entry_date <= $${values.length}`);
      } else {
        if (filters.from_date) {
          values.push(filters.from_date);
          conditions.push(`je.entry_date >= $${values.length}`);
        }
        if (filters.to_date) {
          values.push(filters.to_date);
          conditions.push(`je.entry_date <= $${values.length}`);
        }
      }

      const whereClause = conditions.join(' AND ');

      const sql = `
        SELECT 
          coa.account_type,
          coa.category,
          coa.account_code,
          coa.account_name,
          CASE 
            WHEN coa.account_type = 'revenue' 
            THEN ROUND(COALESCE(SUM(jel.credit_amount), 0.00) - COALESCE(SUM(jel.debit_amount), 0.00), 2)
            ELSE ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2)
          END AS net_amount
        FROM chart_of_accounts coa
        LEFT JOIN (
          SELECT jel_sub.* 
          FROM journal_entry_lines jel_sub
          JOIN journal_entries je ON jel_sub.journal_entry_id = je.id
          WHERE ${whereClause}
        ) jel ON coa.id = jel.account_id
        WHERE coa.account_type IN ('revenue', 'expense') AND coa.is_active = true
        GROUP BY coa.account_type, coa.category, coa.account_code, coa.account_name
        ORDER BY coa.account_code ASC
      `;

      const result = await db.query(sql, values);
      return result.rows;
    }

    const result = await db.query(`SELECT * FROM v_profit_and_loss ORDER BY account_code ASC`);
    return result.rows;
  }

  async getCashBankSummary(client = null) {
    const db = client || { query };
    const result = await db.query(`SELECT * FROM v_cash_bank_summary ORDER BY account_code ASC`);
    return result.rows;
  }

  async getGstReconciliation(client = null) {
    const db = client || { query };
    const result = await db.query(`SELECT * FROM v_gst_reconciliation`);
    return result.rows[0] || null;
  }
}

export const accountingRepository = new AccountingRepository();
