import { query } from '../../config/db.js';

export const partiesRepository = {
  /**
   * Find parties with search, filters, and pagination
   */
  async findAll({ page = 1, limit = 20, search, party_type, is_active, state_code }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(trade_name ILIKE $${paramIndex} OR contact_person ILIKE $${paramIndex} OR phone ILIKE $${paramIndex} OR gstin ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (party_type) {
      conditions.push(`party_type = $${paramIndex}`);
      params.push(party_type);
      paramIndex++;
    }

    if (is_active !== undefined) {
      conditions.push(`is_active = $${paramIndex}`);
      params.push(is_active);
      paramIndex++;
    }

    if (state_code) {
      conditions.push(`state_code = $${paramIndex}`);
      params.push(state_code);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM parties ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    const dataSql = `
      SELECT 
        id, party_type, trade_name, contact_person, phone, email,
        gstin, state_code, state_name, billing_address, shipping_address,
        credit_limit, payment_terms_days, is_active, created_at, updated_at
      FROM parties
      ${whereClause}
      ORDER BY trade_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    params.push(limit, offset);

    const dataRes = await query(dataSql, params);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      parties: dataRes.rows,
    };
  },

  /**
   * Find party by UUID
   */
  async findById(id) {
    const text = `
      SELECT 
        id, party_type, trade_name, contact_person, phone, email,
        gstin, state_code, state_name, billing_address, shipping_address,
        credit_limit, payment_terms_days, is_active, created_at, updated_at
      FROM parties
      WHERE id = $1;
    `;
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  /**
   * Find party by GSTIN
   */
  async findByGstin(gstin) {
    if (!gstin) return null;
    const text = `
      SELECT id, trade_name, gstin, party_type, is_active
      FROM parties
      WHERE UPPER(gstin) = UPPER($1);
    `;
    const res = await query(text, [gstin]);
    return res.rows[0] || null;
  },

  /**
   * Find party by trade name (case-insensitive)
   */
  async findByName(name) {
    const text = `
      SELECT id, trade_name, party_type, is_active
      FROM parties
      WHERE LOWER(trade_name) = LOWER($1);
    `;
    const res = await query(text, [name]);
    return res.rows[0] || null;
  },

  /**
   * Insert new party record
   */
  async create(data) {
    const text = `
      INSERT INTO parties (
        party_type, trade_name, contact_person, phone, email,
        gstin, state_code, state_name, billing_address, shipping_address,
        credit_limit, payment_terms_days, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;
    const res = await query(text, [
      data.party_type,
      data.trade_name,
      data.contact_person || null,
      data.phone,
      data.email || null,
      data.gstin || null,
      data.state_code,
      data.state_name,
      data.billing_address,
      data.shipping_address || null,
      data.credit_limit ?? 0.00,
      data.payment_terms_days ?? 30,
      data.is_active ?? true,
    ]);
    return res.rows[0];
  },

  /**
   * Update party fields
   */
  async update(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    if (fields.length === 0) {
      return await this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const text = `
      UPDATE parties
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *;
    `;
    const res = await query(text, values);
    return res.rows[0] || null;
  },

  /**
   * Toggle party active status
   */
  async setStatus(id, isActive) {
    const text = `
      UPDATE parties
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, trade_name, party_type, is_active, updated_at;
    `;
    const res = await query(text, [isActive, id]);
    return res.rows[0] || null;
  },

  /**
   * Count references in transactional tables (sales_orders, invoices, purchase_bills, payments)
   */
  async countTransactionReferences(id) {
    const text = `
      SELECT 
        (SELECT COUNT(*) FROM sales_orders WHERE customer_id = $1) +
        (SELECT COUNT(*) FROM invoices WHERE customer_id = $1) +
        (SELECT COUNT(*) FROM purchase_bills WHERE supplier_id = $1) +
        (SELECT COUNT(*) FROM payments WHERE customer_id = $1) AS total;
    `;
    const res = await query(text, [id]);
    return parseInt(res.rows[0].total, 10);
  },
};
