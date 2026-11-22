import { query } from '../../config/db.js';
import { roundMoney, PAYROLL_STATUS } from './payroll.constants.js';

class PayrollRepository {
  // ============================================================================
  // EMPLOYEES
  // ============================================================================

  async findAllEmployees(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.is_active !== undefined) {
      values.push(filters.is_active === 'true' || filters.is_active === true);
      conditions.push(`is_active = $${values.length}`);
    }

    if (filters.department) {
      values.push(filters.department);
      conditions.push(`department = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM employees ${whereClause} ORDER BY employee_code ASC`;
    const res = await db.query(sql, values);
    return res.rows;
  }

  async findEmployeeById(id, client = null) {
    const db = client || { query };
    const res = await db.query(`SELECT * FROM employees WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }

  async findEmployeeByCode(code, client = null) {
    const db = client || { query };
    const res = await db.query(`SELECT * FROM employees WHERE employee_code = $1`, [code]);
    return res.rows[0] || null;
  }

  async createEmployee(data, client = null) {
    const db = client || { query };
    const res = await db.query(
      `INSERT INTO employees (
        employee_code,
        full_name,
        department,
        designation,
        joining_date,
        base_salary,
        bank_account_number,
        bank_ifsc,
        pan_number,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        data.employee_code,
        data.full_name,
        data.department,
        data.designation,
        data.joining_date,
        roundMoney(data.base_salary),
        data.bank_account_number || null,
        data.bank_ifsc || null,
        data.pan_number || null,
        data.is_active !== undefined ? data.is_active : true,
      ]
    );
    return res.rows[0];
  }

  async updateEmployee(id, data, client = null) {
    const db = client || { query };
    const fields = [];
    const values = [];

    if (data.full_name !== undefined) {
      values.push(data.full_name);
      fields.push(`full_name = $${values.length}`);
    }
    if (data.department !== undefined) {
      values.push(data.department);
      fields.push(`department = $${values.length}`);
    }
    if (data.designation !== undefined) {
      values.push(data.designation);
      fields.push(`designation = $${values.length}`);
    }
    if (data.base_salary !== undefined) {
      values.push(roundMoney(data.base_salary));
      fields.push(`base_salary = $${values.length}`);
    }
    if (data.bank_account_number !== undefined) {
      values.push(data.bank_account_number);
      fields.push(`bank_account_number = $${values.length}`);
    }
    if (data.bank_ifsc !== undefined) {
      values.push(data.bank_ifsc);
      fields.push(`bank_ifsc = $${values.length}`);
    }
    if (data.pan_number !== undefined) {
      values.push(data.pan_number);
      fields.push(`pan_number = $${values.length}`);
    }
    if (data.is_active !== undefined) {
      values.push(data.is_active);
      fields.push(`is_active = $${values.length}`);
    }

    if (fields.length === 0) return this.findEmployeeById(id, client);

    values.push(id);
    const sql = `
      UPDATE employees
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;
    const res = await db.query(sql, values);
    return res.rows[0] || null;
  }

  // ============================================================================
  // PAYROLL RUNS
  // ============================================================================

  async findPayrollByPeriod(period, client = null) {
    const db = client || { query };
    const res = await db.query(`SELECT * FROM payroll_runs WHERE payroll_period = $1`, [period]);
    return res.rows[0] || null;
  }

  async findPayrollById(id, client = null) {
    const db = client || { query };
    const runRes = await db.query(
      `SELECT 
        pr.*,
        u_creat.username AS created_by_username,
        u_app.username AS approved_by_username
      FROM payroll_runs pr
      JOIN users u_creat ON pr.created_by = u_creat.id
      LEFT JOIN users u_app ON pr.approved_by = u_app.id
      WHERE pr.id = $1`,
      [id]
    );

    if (runRes.rows.length === 0) return null;
    const run = runRes.rows[0];

    const itemsRes = await db.query(
      `SELECT 
        pi.*,
        e.employee_code,
        e.full_name,
        e.department,
        e.designation,
        e.bank_account_number
      FROM payroll_items pi
      JOIN employees e ON pi.employee_id = e.id
      WHERE pi.payroll_run_id = $1
      ORDER BY e.employee_code ASC`,
      [id]
    );

    return {
      ...run,
      items: itemsRes.rows,
    };
  }

  async createPayrollRun(header, items, client) {
    const db = client || { query };

    const runRes = await db.query(
      `INSERT INTO payroll_runs (
        payroll_period,
        run_date,
        total_gross_salary,
        total_deductions,
        total_net_salary,
        status,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        header.payroll_period,
        header.run_date,
        roundMoney(header.total_gross_salary),
        roundMoney(header.total_deductions),
        roundMoney(header.total_net_salary),
        header.status || PAYROLL_STATUS.DRAFT,
        header.created_by,
      ]
    );

    const run = runRes.rows[0];
    const insertedItems = [];

    for (const item of items) {
      const itemRes = await db.query(
        `INSERT INTO payroll_items (
          payroll_run_id,
          employee_id,
          basic_salary,
          allowances,
          deductions,
          net_salary,
          present_days,
          absent_days,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          run.id,
          item.employee_id,
          roundMoney(item.basic_salary),
          roundMoney(item.allowances || 0),
          roundMoney(item.deductions || 0),
          roundMoney(item.net_salary),
          item.present_days !== undefined ? item.present_days : 30,
          item.absent_days || 0,
          item.notes || null,
        ]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    return {
      ...run,
      items: insertedItems,
    };
  }

  async findAllPayrollRuns(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT 
        pr.*,
        u.username AS created_by_username,
        (SELECT COUNT(*)::int FROM payroll_items WHERE payroll_run_id = pr.id) AS employee_count
      FROM payroll_runs pr
      JOIN users u ON pr.created_by = u.id
      ${whereClause}
      ORDER BY pr.payroll_period DESC
    `;
    const res = await db.query(sql, values);
    return res.rows;
  }

  async updatePayrollRun(id, data, client = null) {
    const db = client || { query };
    const fields = [];
    const values = [];

    if (data.status !== undefined) {
      values.push(data.status);
      fields.push(`status = $${values.length}`);
    }
    if (data.payment_mode !== undefined) {
      values.push(data.payment_mode);
      fields.push(`payment_mode = $${values.length}`);
    }
    if (data.reference_txn_id !== undefined) {
      values.push(data.reference_txn_id);
      fields.push(`reference_txn_id = $${values.length}`);
    }
    if (data.approved_by !== undefined) {
      values.push(data.approved_by);
      fields.push(`approved_by = $${values.length}`);
    }
    if (data.approved_at !== undefined) {
      values.push(data.approved_at);
      fields.push(`approved_at = $${values.length}`);
    }
    if (data.paid_at !== undefined) {
      values.push(data.paid_at);
      fields.push(`paid_at = $${values.length}`);
    }

    if (fields.length === 0) return this.findPayrollById(id, client);

    values.push(id);
    const sql = `
      UPDATE payroll_runs
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;
    const res = await db.query(sql, values);
    return res.rows[0] || null;
  }
}

export const payrollRepository = new PayrollRepository();
