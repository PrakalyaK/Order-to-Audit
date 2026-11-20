import { query } from '../../config/db.js';

export const itemsRepository = {
  /**
   * Find items with search, filters, and pagination
   */
  async findAll({ page = 1, limit = 20, search, item_type, is_active, base_uom_id }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(sku ILIKE $${paramIndex} OR name ILIKE $${paramIndex} OR hsn_code ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (item_type) {
      conditions.push(`item_type = $${paramIndex}`);
      params.push(item_type);
      paramIndex++;
    }

    if (is_active !== undefined) {
      conditions.push(`is_active = $${paramIndex}`);
      params.push(is_active);
      paramIndex++;
    }

    if (base_uom_id) {
      conditions.push(`base_uom_id = $${paramIndex}`);
      params.push(base_uom_id);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total records
    const countSql = `SELECT COUNT(*) AS total FROM items ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    // Fetch paginated rows with UOM details
    const dataSql = `
      SELECT 
        i.id, i.sku, i.name, i.item_type, i.base_uom_id,
        u.name AS base_uom_name, u.dimension AS uom_dimension,
        i.hsn_code, i.gst_rate_pct, i.standard_selling_price, i.standard_purchase_rate,
        i.min_reorder_level, i.packets_per_carton, i.is_active,
        i.created_at, i.updated_at
      FROM items i
      JOIN units_of_measure u ON i.base_uom_id = u.id
      ${whereClause}
      ORDER BY i.name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    params.push(limit, offset);

    const dataRes = await query(dataSql, params);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      items: dataRes.rows,
    };
  },

  /**
   * Find item by UUID
   */
  async findById(id) {
    const text = `
      SELECT 
        i.id, i.sku, i.name, i.item_type, i.base_uom_id,
        u.name AS base_uom_name, u.dimension AS uom_dimension,
        i.hsn_code, i.gst_rate_pct, i.standard_selling_price, i.standard_purchase_rate,
        i.min_reorder_level, i.packets_per_carton, i.is_active,
        i.created_at, i.updated_at
      FROM items i
      JOIN units_of_measure u ON i.base_uom_id = u.id
      WHERE i.id = $1;
    `;
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  /**
   * Find item by SKU (case-insensitive)
   */
  async findBySku(sku) {
    const text = `
      SELECT id, sku, name, item_type, is_active
      FROM items
      WHERE LOWER(sku) = LOWER($1);
    `;
    const res = await query(text, [sku]);
    return res.rows[0] || null;
  },

  /**
   * Insert new item record
   */
  async create(data) {
    const text = `
      INSERT INTO items (
        sku, name, item_type, base_uom_id, hsn_code,
        gst_rate_pct, standard_selling_price, standard_purchase_rate,
        min_reorder_level, packets_per_carton, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;
    const res = await query(text, [
      data.sku,
      data.name,
      data.item_type,
      data.base_uom_id,
      data.hsn_code,
      data.gst_rate_pct ?? 5.00,
      data.standard_selling_price ?? 0.00,
      data.standard_purchase_rate ?? 0.00,
      data.min_reorder_level ?? 0.0000,
      data.packets_per_carton ?? 1.00,
      data.is_active ?? true,
    ]);
    return res.rows[0];
  },

  /**
   * Update item fields
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
      UPDATE items
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *;
    `;
    const res = await query(text, values);
    return res.rows[0] || null;
  },

  /**
   * Toggle item active status
   */
  async setStatus(id, isActive) {
    const text = `
      UPDATE items
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, sku, name, is_active, updated_at;
    `;
    const res = await query(text, [isActive, id]);
    return res.rows[0] || null;
  },

  /**
   * Check if item has active references in recipes/BOMs
   */
  async countActiveBomReferences(id) {
    const text = `
      SELECT COUNT(*) AS total
      FROM boms b
      JOIN bom_items bi ON b.id = bi.bom_id
      WHERE (b.finished_good_item_id = $1 OR bi.item_id = $1)
        AND b.is_active = true;
    `;
    const res = await query(text, [id]);
    return parseInt(res.rows[0].total, 10);
  },
};
