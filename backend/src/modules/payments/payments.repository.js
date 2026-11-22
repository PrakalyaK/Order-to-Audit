import { query, getClient } from '../../config/db.js';
import { roundMoney } from './payments.constants.js';

export const paymentsRepository = {
  /**
   * Sequential payment receipt number generator: REC-YYYY-XXXX
   */
  async generateReceiptNumber(paymentDate = new Date(), client = null) {
    const year = new Date(paymentDate).getFullYear();
    const prefix = `REC-${year}-`;
    const runner = client || { query };

    const res = await runner.query(
      `SELECT receipt_number FROM payments 
       WHERE receipt_number LIKE $1 
       ORDER BY receipt_number DESC 
       LIMIT 1;`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].receipt_number.match(new RegExp(`^REC-${year}-(\\d+)$`));
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  },

  /**
   * Create a new payment record
   */
  async create(paymentData, client = null) {
    const runner = client || { query };

    const sql = `
      INSERT INTO payments (
        receipt_number,
        customer_id,
        payment_date,
        total_amount,
        payment_mode,
        reference_txn_id,
        bank_name,
        bank_branch,
        cheque_number,
        cheque_date,
        notes,
        status,
        recorded_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;

    const res = await runner.query(sql, [
      paymentData.receipt_number,
      paymentData.customer_id,
      paymentData.payment_date,
      paymentData.total_amount,
      paymentData.payment_mode,
      paymentData.reference_txn_id || null,
      paymentData.bank_name || null,
      paymentData.bank_branch || null,
      paymentData.cheque_number || null,
      paymentData.cheque_date || null,
      paymentData.notes || null,
      paymentData.status || 'posted',
      paymentData.recorded_by,
    ]);

    return res.rows[0];
  },

  /**
   * Update draft payment details
   */
  async updateDraft(id, updateData, client = null) {
    const runner = client || { query };
    const fields = [];
    const values = [];
    let idx = 1;

    const allowedFields = [
      'payment_date',
      'total_amount',
      'payment_mode',
      'reference_txn_id',
      'bank_name',
      'bank_branch',
      'cheque_number',
      'cheque_date',
      'notes',
    ];

    for (const key of allowedFields) {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(updateData[key]);
      }
    }

    if (fields.length === 0) return this.findById(id, client);

    values.push(id);
    const sql = `
      UPDATE payments 
      SET ${fields.join(', ')} 
      WHERE id = $${idx} AND status = 'draft'
      RETURNING *;
    `;

    const res = await runner.query(sql, values);
    return res.rows[0] || null;
  },

  /**
   * Transition draft payment to posted
   */
  async updateStatusToPosted(id, client = null) {
    const runner = client || { query };
    const res = await runner.query(
      `UPDATE payments SET status = 'posted' WHERE id = $1 AND status = 'draft' RETURNING *;`,
      [id]
    );
    return res.rows[0] || null;
  },

  /**
   * Transition draft payment to cancelled
   */
  async cancelDraft(id, client = null) {
    const runner = client || { query };
    const res = await runner.query(
      `UPDATE payments SET status = 'cancelled' WHERE id = $1 AND status = 'draft' RETURNING *;`,
      [id]
    );
    return res.rows[0] || null;
  },

  /**
   * Find payment by ID with customer, user, and allocations breakdown
   */
  async findById(id, client = null) {
    const runner = client || { query };

    const paymentSql = `
      SELECT 
        p.*,
        c.trade_name AS customer_name,
        c.gstin AS customer_gstin,
        c.state_code AS customer_state_code,
        c.phone AS customer_phone,
        u.username AS recorded_by_username
      FROM payments p
      JOIN parties c ON p.customer_id = c.id
      JOIN users u ON p.recorded_by = u.id
      WHERE p.id = $1;
    `;
    const paymentRes = await runner.query(paymentSql, [id]);
    if (paymentRes.rows.length === 0) return null;

    const payment = paymentRes.rows[0];

    // Fetch allocations
    const allocSql = `
      SELECT 
        pa.id,
        pa.payment_id,
        pa.invoice_id,
        pa.allocated_amount,
        pa.status,
        pa.allocated_at,
        pa.reversed_at,
        pa.reversal_reason,
        inv.invoice_number,
        inv.invoice_date,
        inv.total_invoice_value,
        u.username AS allocated_by_username
      FROM payment_allocations pa
      JOIN invoices inv ON pa.invoice_id = inv.id
      JOIN users u ON pa.allocated_by = u.id
      WHERE pa.payment_id = $1
      ORDER BY pa.allocated_at ASC;
    `;
    const allocRes = await runner.query(allocSql, [id]);

    const activeAllocations = allocRes.rows.filter((a) => a.status === 'active');
    const reversedAllocations = allocRes.rows.filter((a) => a.status === 'reversed');

    const totalAllocated = activeAllocations.reduce((sum, a) => sum + Number(a.allocated_amount), 0);
    const totalAmount = Number(payment.total_amount);
    const unallocatedAmount = roundMoney(Math.max(0, totalAmount - totalAllocated));

    return {
      ...payment,
      total_allocated: roundMoney(totalAllocated),
      unallocated_amount: unallocatedAmount,
      allocations: allocRes.rows,
      active_allocations: activeAllocations,
      reversed_allocations: reversedAllocations,
    };
  },

  /**
   * Find paginated payments
   */
  async findAll({ page = 1, limit = 20, status, customerId, paymentMode, fromDate, toDate, receiptNumber }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`p.status = $${idx++}`);
      params.push(status);
    }
    if (customerId) {
      conditions.push(`p.customer_id = $${idx++}`);
      params.push(customerId);
    }
    if (paymentMode) {
      conditions.push(`p.payment_mode = $${idx++}`);
      params.push(paymentMode);
    }
    if (fromDate) {
      conditions.push(`p.payment_date >= $${idx++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`p.payment_date <= $${idx++}`);
      params.push(toDate);
    }
    if (receiptNumber) {
      conditions.push(`p.receipt_number ILIKE $${idx++}`);
      params.push(`%${receiptNumber}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM payments p ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT 
        p.*,
        c.trade_name AS customer_name,
        c.gstin AS customer_gstin,
        u.username AS recorded_by_username,
        COALESCE(pa.total_allocated, 0.00) AS total_allocated,
        ROUND(p.total_amount - COALESCE(pa.total_allocated, 0.00), 2) AS unallocated_amount
      FROM payments p
      JOIN parties c ON p.customer_id = c.id
      JOIN users u ON p.recorded_by = u.id
      LEFT JOIN (
        SELECT payment_id, SUM(allocated_amount) AS total_allocated
        FROM payment_allocations
        WHERE status = 'active'
        GROUP BY payment_id
      ) pa ON p.id = pa.payment_id
      ${whereClause}
      ORDER BY p.payment_date DESC, p.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++};
    `;

    const dataRes = await query(dataSql, [...params, limit, offset]);

    return {
      payments: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Execute atomic payment allocation via PostgreSQL function fn_allocate_payment
   */
  async allocate(paymentId, invoiceId, amount, userId, client = null) {
    const runner = client || { query };
    const res = await runner.query(
      `SELECT fn_allocate_payment($1, $2, $3, $4) AS allocation_id;`,
      [paymentId, invoiceId, amount, userId]
    );
    return res.rows[0].allocation_id;
  },

  /**
   * Execute atomic payment reversal via PostgreSQL function fn_reverse_payment
   */
  async reverse(paymentId, userId, reason, client = null) {
    const runner = client || { query };
    await runner.query(
      `SELECT fn_reverse_payment($1, $2, $3);`,
      [paymentId, userId, reason]
    );
    return true;
  },

  /**
   * Execute atomic allocation reversal via PostgreSQL function fn_unallocate_payment
   */
  async unallocate(allocationId, userId, reason, client = null) {
    const runner = client || { query };
    await runner.query(
      `SELECT fn_unallocate_payment($1, $2, $3);`,
      [allocationId, userId, reason]
    );
    return true;
  },

  /**
   * Find all allocations for a specific invoice
   */
  async findAllocationsByInvoiceId(invoiceId) {
    const sql = `
      SELECT 
        pa.id AS allocation_id,
        pa.payment_id,
        pa.allocated_amount,
        pa.status AS allocation_status,
        pa.allocated_at,
        pa.reversed_at,
        pa.reversal_reason,
        p.receipt_number,
        p.payment_date,
        p.payment_mode,
        p.reference_txn_id,
        p.status AS payment_status,
        u.username AS allocated_by_username
      FROM payment_allocations pa
      JOIN payments p ON pa.payment_id = p.id
      JOIN users u ON pa.allocated_by = u.id
      WHERE pa.invoice_id = $1
      ORDER BY pa.allocated_at DESC;
    `;
    const res = await query(sql, [invoiceId]);
    return res.rows;
  },

  /**
   * Find all payments and allocations for a specific customer
   */
  async findCustomerPaymentHistory(customerId) {
    const paymentsSql = `
      SELECT 
        p.*,
        u.username AS recorded_by_username,
        COALESCE(pa.total_allocated, 0.00) AS total_allocated,
        ROUND(p.total_amount - COALESCE(pa.total_allocated, 0.00), 2) AS unallocated_amount
      FROM payments p
      JOIN users u ON p.recorded_by = u.id
      LEFT JOIN (
        SELECT payment_id, SUM(allocated_amount) AS total_allocated
        FROM payment_allocations
        WHERE status = 'active'
        GROUP BY payment_id
      ) pa ON p.id = pa.payment_id
      WHERE p.customer_id = $1
      ORDER BY p.payment_date DESC, p.created_at DESC;
    `;
    const paymentsRes = await query(paymentsSql, [customerId]);

    const allocationsSql = `
      SELECT 
        pa.id AS allocation_id,
        pa.payment_id,
        pa.invoice_id,
        pa.allocated_amount,
        pa.status AS allocation_status,
        pa.allocated_at,
        inv.invoice_number,
        inv.invoice_date,
        inv.total_invoice_value,
        p.receipt_number
      FROM payment_allocations pa
      JOIN payments p ON pa.payment_id = p.id
      JOIN invoices inv ON pa.invoice_id = inv.id
      WHERE p.customer_id = $1
      ORDER BY pa.allocated_at DESC;
    `;
    const allocationsRes = await query(allocationsSql, [customerId]);

    return {
      payments: paymentsRes.rows,
      allocations: allocationsRes.rows,
    };
  },

  /**
   * Query customer outstanding from view v_customer_outstanding
   */
  async findCustomerReceivables({ customerId, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (customerId) {
      conditions.push(`customer_id = $${idx++}`);
      params.push(customerId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM v_customer_outstanding ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT * 
      FROM v_customer_outstanding
      ${whereClause}
      ORDER BY net_invoice_receivables DESC, customer_name ASC
      LIMIT $${idx++} OFFSET $${idx++};
    `;
    const dataRes = await query(dataSql, [...params, limit, offset]);

    return {
      receivables: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Query invoice balances from view v_invoice_balances
   */
  async findInvoiceBalances({ customerId, status, minOutstanding, page = 1, limit = 20 }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (customerId) {
      conditions.push(`customer_id = $${idx++}`);
      params.push(customerId);
    }
    if (status) {
      conditions.push(`derived_payment_status = $${idx++}`);
      params.push(status);
    }
    if (minOutstanding !== undefined && minOutstanding !== null) {
      conditions.push(`outstanding_balance >= $${idx++}`);
      params.push(minOutstanding);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM v_invoice_balances ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT * 
      FROM v_invoice_balances
      ${whereClause}
      ORDER BY invoice_date DESC, created_at DESC
      LIMIT $${idx++} OFFSET $${idx++};
    `;
    const dataRes = await query(dataSql, [...params, limit, offset]);

    return {
      invoices: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Compute comprehensive receivables summary
   */
  async getReceivablesSummary() {
    const summarySql = `
      SELECT 
        -- Invoicing totals
        COALESCE(SUM(total_invoice_value), 0.00) AS total_invoiced_amount,
        COALESCE(SUM(total_paid_amount), 0.00) AS total_allocated_payments,
        COALESCE(SUM(total_credited_amount), 0.00) AS total_credited_amount,
        COALESCE(SUM(outstanding_balance), 0.00) AS total_outstanding_amount,
        -- Status counts and totals
        COUNT(*) FILTER (WHERE derived_payment_status = 'unpaid') AS count_unpaid,
        COALESCE(SUM(outstanding_balance) FILTER (WHERE derived_payment_status = 'unpaid'), 0.00) AS total_unpaid,
        COUNT(*) FILTER (WHERE derived_payment_status = 'partially_paid') AS count_partially_paid,
        COALESCE(SUM(outstanding_balance) FILTER (WHERE derived_payment_status = 'partially_paid'), 0.00) AS total_partially_paid,
        COUNT(*) FILTER (WHERE derived_payment_status = 'paid') AS count_paid,
        COALESCE(SUM(total_invoice_value) FILTER (WHERE derived_payment_status = 'paid'), 0.00) AS total_settled_invoices
      FROM v_invoice_balances
      WHERE invoice_status <> 'cancelled';
    `;
    const summaryRes = await query(summarySql);

    const paymentTotalsSql = `
      SELECT 
        COALESCE(SUM(total_amount), 0.00) AS total_payments_received,
        COUNT(*) AS count_payments
      FROM payments
      WHERE status = 'posted';
    `;
    const paymentTotalsRes = await query(paymentTotalsSql);

    const customerSummarySql = `
      SELECT 
        COUNT(DISTINCT customer_id) AS total_customers_with_receivables,
        COALESCE(SUM(unallocated_advances), 0.00) AS total_unallocated_advances,
        COALESCE(SUM(ageing_0_to_30_days), 0.00) AS ageing_0_to_30_days,
        COALESCE(SUM(ageing_31_to_60_days), 0.00) AS ageing_31_to_60_days,
        COALESCE(SUM(ageing_61_to_90_days), 0.00) AS ageing_61_to_90_days,
        COALESCE(SUM(ageing_over_90_days), 0.00) AS ageing_over_90_days
      FROM v_customer_outstanding;
    `;
    const customerSummaryRes = await query(customerSummarySql);

    return {
      ...summaryRes.rows[0],
      ...paymentTotalsRes.rows[0],
      ...customerSummaryRes.rows[0],
    };
  },
};
