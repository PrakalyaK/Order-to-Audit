import { query } from '../../config/db.js';

export const inventoryRepository = {
  /**
   * Query real-time current stock balances using analytical view v_current_stock
   */
  async findCurrentStock({ search, item_type, is_low_stock }) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(sku ILIKE $${paramIndex} OR item_name ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (item_type) {
      conditions.push(`item_type = $${paramIndex}`);
      params.push(item_type);
      paramIndex++;
    }

    if (is_low_stock !== undefined) {
      conditions.push(`is_low_stock_alert = $${paramIndex}`);
      params.push(is_low_stock);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const text = `
      SELECT 
        item_id, sku, item_name, item_type, base_uom_id,
        packets_per_carton, closing_stock_base_qty, equivalent_cartons,
        current_moving_wac, total_stock_valuation, min_reorder_level,
        is_low_stock_alert, last_transaction_timestamp
      FROM v_current_stock
      ${whereClause}
      ORDER BY item_type, sku;
    `;
    const res = await query(text, params);
    return res.rows;
  },

  /**
   * Find current stock balance for a single item by ID
   */
  async findStockByItemId(itemId) {
    const text = `
      SELECT 
        item_id, sku, item_name, item_type, base_uom_id,
        packets_per_carton, closing_stock_base_qty, equivalent_cartons,
        current_moving_wac, total_stock_valuation, min_reorder_level,
        is_low_stock_alert, last_transaction_timestamp
      FROM v_current_stock
      WHERE item_id = $1;
    `;
    const res = await query(text, [itemId]);
    return res.rows[0] || null;
  },

  /**
   * Find items currently at or below their configured min_reorder_level
   */
  async findLowStock() {
    const text = `
      SELECT 
        item_id, sku, item_name, item_type, base_uom_id,
        closing_stock_base_qty, min_reorder_level,
        ROUND(min_reorder_level - closing_stock_base_qty, 4) AS shortfall_qty,
        current_moving_wac, total_stock_valuation, last_transaction_timestamp
      FROM v_current_stock
      WHERE is_low_stock_alert = true
      ORDER BY (min_reorder_level - closing_stock_base_qty) DESC;
    `;
    const res = await query(text);
    return res.rows;
  },

  /**
   * Get total inventory valuation and valuation breakdown by item_type
   */
  async findValuationSummary() {
    const text = `
      SELECT 
        item_type,
        COUNT(*)::int AS items_count,
        COALESCE(SUM(closing_stock_base_qty), 0.0000) AS total_base_qty,
        COALESCE(SUM(total_stock_valuation), 0.00) AS total_valuation
      FROM v_current_stock
      GROUP BY item_type
      ORDER BY total_valuation DESC;
    `;
    const breakdownRes = await query(text);

    const totalValuation = breakdownRes.rows.reduce(
      (sum, row) => sum + parseFloat(row.total_valuation),
      0
    );

    return {
      total_valuation: Math.round(totalValuation * 100) / 100,
      breakdown_by_item_type: breakdownRes.rows,
    };
  },

  /**
   * Query the immutable inventory ledger register
   */
  async findStockLedger({ page = 1, limit = 20, item_id, movement_type, from_date, to_date }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (item_id) {
      conditions.push(`l.item_id = $${paramIndex}`);
      params.push(item_id);
      paramIndex++;
    }

    if (movement_type) {
      conditions.push(`l.movement_type = $${paramIndex}`);
      params.push(movement_type);
      paramIndex++;
    }

    if (from_date) {
      conditions.push(`l.transaction_timestamp >= $${paramIndex}::date`);
      params.push(from_date);
      paramIndex++;
    }

    if (to_date) {
      conditions.push(`l.transaction_timestamp < ($${paramIndex}::date + interval '1 day')`);
      params.push(to_date);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*) AS total
      FROM inventory_ledger l
      ${whereClause};
    `;
    const countRes = await query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    const dataSql = `
      SELECT 
        l.id AS ledger_id,
        l.transaction_timestamp,
        l.item_id,
        i.sku,
        i.name AS item_name,
        i.item_type,
        l.movement_type,
        l.transaction_qty,
        l.transaction_uom_id,
        l.base_quantity_delta,
        i.base_uom_id,
        l.unit_cost,
        l.total_cost,
        l.source_reference_label,
        l.batch_number,
        l.expiry_date,
        u.username AS recorded_by_username,
        u.full_name AS recorded_by_user
      FROM inventory_ledger l
      JOIN items i ON l.item_id = i.id
      JOIN users u ON l.created_by = u.id
      ${whereClause}
      ORDER BY l.transaction_timestamp DESC, l.id DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    params.push(limit, offset);

    const dataRes = await query(dataSql, params);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      entries: dataRes.rows,
    };
  },
};
