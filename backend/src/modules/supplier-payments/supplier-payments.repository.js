import { query } from '../../config/db.js';
import { roundMoney, SUPPLIER_PAYMENT_STATUS } from './supplier-payments.constants.js';

class SupplierPaymentsRepository {
  async generatePaymentNumber(paymentDate, client = null) {
    const db = client || { query };
    const dateObj = paymentDate ? new Date(paymentDate) : new Date();
    const year = dateObj.getFullYear();
    const prefix = `SPAY-${year}-`;

    const res = await db.query(
      `SELECT payment_number 
       FROM supplier_payments 
       WHERE payment_number LIKE $1 
       ORDER BY payment_number DESC 
       LIMIT 1 FOR UPDATE`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].payment_number.match(/\d+$/);
      if (match) {
        nextSeq = parseInt(match[0], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  async createPayment(data, client = null) {
    const db = client || { query };

    const res = await db.query(
      `INSERT INTO supplier_payments (
        payment_number,
        supplier_id,
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
      RETURNING *`,
      [
        data.payment_number,
        data.supplier_id,
        data.payment_date,
        roundMoney(data.total_amount),
        data.payment_mode,
        data.reference_txn_id || null,
        data.bank_name || null,
        data.bank_branch || null,
        data.cheque_number || null,
        data.cheque_date || null,
        data.notes || null,
        data.status || SUPPLIER_PAYMENT_STATUS.POSTED,
        data.recorded_by,
      ]
    );

    return res.rows[0];
  }

  async findPaymentById(id, client = null) {
    const db = client || { query };

    const payRes = await db.query(
      `SELECT 
        sp.*,
        p.trade_name AS supplier_name,
        p.phone AS supplier_phone,
        p.email AS supplier_email,
        p.gstin AS supplier_gstin,
        u_rec.username AS recorded_by_username,
        u_rev.username AS reversed_by_username
      FROM supplier_payments sp
      JOIN parties p ON sp.supplier_id = p.id
      LEFT JOIN users u_rec ON sp.recorded_by = u_rec.id
      LEFT JOIN users u_rev ON sp.reversed_by = u_rev.id
      WHERE sp.id = $1`,
      [id]
    );

    if (payRes.rows.length === 0) return null;
    const payment = payRes.rows[0];

    const allocRes = await db.query(
      `SELECT 
        spa.*,
        pb.bill_number,
        pb.bill_date,
        pb.total_amount AS bill_total_amount,
        u.username AS allocated_by_username
      FROM supplier_payment_allocations spa
      JOIN purchase_bills pb ON spa.purchase_bill_id = pb.id
      LEFT JOIN users u ON spa.allocated_by = u.id
      WHERE spa.supplier_payment_id = $1
      ORDER BY spa.allocated_at ASC`,
      [id]
    );

    const totalAllocated = allocRes.rows
      .filter((a) => a.status === 'active')
      .reduce((sum, a) => sum + Number(a.allocated_amount), 0);

    return {
      ...payment,
      amount: roundMoney(Number(payment.total_amount)),
      total_allocated_amount: roundMoney(totalAllocated),
      allocated_amount: roundMoney(totalAllocated),
      unallocated_advance_amount: roundMoney(Number(payment.total_amount) - totalAllocated),
      unallocated_amount: roundMoney(Number(payment.total_amount) - totalAllocated),
      allocations: allocRes.rows,
    };
  }

  async findPayments(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.supplier_id) {
      values.push(filters.supplier_id);
      conditions.push(`sp.supplier_id = $${values.length}`);
    }

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`sp.status = $${values.length}`);
    }

    if (filters.from_date) {
      values.push(filters.from_date);
      conditions.push(`sp.payment_date >= $${values.length}`);
    }

    if (filters.to_date) {
      values.push(filters.to_date);
      conditions.push(`sp.payment_date <= $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM supplier_payments sp ${whereClause}`,
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
        sp.*,
        p.trade_name AS supplier_name,
        u.username AS recorded_by_username,
        COALESCE((
          SELECT SUM(spa.allocated_amount) 
          FROM supplier_payment_allocations spa 
          WHERE spa.supplier_payment_id = sp.id AND spa.status = 'active'
        ), 0.00) AS total_allocated_amount
      FROM supplier_payments sp
      JOIN parties p ON sp.supplier_id = p.id
      LEFT JOIN users u ON sp.recorded_by = u.id
      ${whereClause}
      ORDER BY sp.payment_date DESC, sp.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const rowsRes = await db.query(sql, values);

    return {
      payments: rowsRes.rows.map((p) => ({
        ...p,
        unallocated_advance_amount: roundMoney(
          Number(p.total_amount) - Number(p.total_allocated_amount)
        ),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async allocatePayment(paymentId, billId, amount, userId, client = null) {
    const db = client || { query };
    const res = await db.query(
      `SELECT fn_allocate_supplier_payment($1, $2, $3, $4) AS allocation_id`,
      [paymentId, billId, roundMoney(amount), userId]
    );
    return res.rows[0].allocation_id;
  }

  async reversePayment(paymentId, userId, reason, client = null) {
    const db = client || { query };
    await db.query(`SELECT fn_reverse_supplier_payment($1, $2, $3)`, [
      paymentId,
      userId,
      reason,
    ]);
    return this.findPaymentById(paymentId, client);
  }

  async getPayablesSummary(client = null) {
    const db = client || { query };
    const res = await db.query(`
      SELECT 
        COALESCE(SUM(total_billed_amount), 0.00) AS total_billed,
        COALESCE(SUM(total_billed_amount), 0.00) AS total_billed_amount,
        COALESCE(SUM(total_paid_amount), 0.00) AS total_paid,
        COALESCE(SUM(total_paid_amount), 0.00) AS total_paid_amount,
        COALESCE(SUM(current_outstanding), 0.00) AS total_outstanding,
        COALESCE(SUM(unallocated_advances), 0.00) AS total_unallocated_advances,
        COALESCE(SUM(net_payable_balance), 0.00) AS total_net_payable
      FROM v_supplier_outstanding;
    `);
    return res.rows[0];
  }

  async getSupplierOutstanding(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.supplier_id) {
      values.push(filters.supplier_id);
      conditions.push(`supplier_id = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await db.query(`SELECT * FROM v_supplier_outstanding ${whereClause} ORDER BY current_outstanding DESC`, values);
    return res.rows;
  }

  async getPurchaseBillBalances(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.supplier_id) {
      values.push(filters.supplier_id);
      conditions.push(`supplier_id = $${values.length}`);
    }

    if (filters.payment_status) {
      values.push(filters.payment_status);
      conditions.push(`payment_status = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await db.query(`SELECT * FROM v_purchase_bill_balances ${whereClause} ORDER BY bill_date DESC`, values);
    return res.rows;
  }
}

export const supplierPaymentsRepository = new SupplierPaymentsRepository();
