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

  /**
   * Generate sequential adjustment number ADJ-YYYY-XXXX
   */
  async generateAdjustmentNumber(adjustmentDate, client = null) {
    const db = client || { query };
    const dateObj = adjustmentDate ? new Date(adjustmentDate) : new Date();
    const year = dateObj.getFullYear();
    const prefix = `ADJ-${year}-`;

    const res = await db.query(
      `SELECT adjustment_number 
       FROM stock_adjustments 
       WHERE adjustment_number LIKE $1 
       ORDER BY adjustment_number DESC 
       LIMIT 1 FOR UPDATE`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].adjustment_number.match(/\d+$/);
      if (match) {
        nextSeq = parseInt(match[0], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  },

  /**
   * Create stock adjustment draft
   */
  async createStockAdjustment(data, client = null) {
    const db = client || { query };

    // Fetch current book quantity
    const balRes = await db.query(
      `SELECT current_base_qty, current_moving_wac FROM item_stock_balances WHERE item_id = $1`,
      [data.item_id]
    );
    const bookQty = Number(balRes.rows[0]?.current_base_qty) || 0;
    const wac = Number(balRes.rows[0]?.current_moving_wac) || 0;
    const physicalQty = data.physical_quantity !== undefined
      ? Number(data.physical_quantity)
      : data.physical_count !== undefined
        ? Number(data.physical_count)
        : (bookQty + Number(data.discrepancy_quantity || 0));
    const diffQty = physicalQty - bookQty;
    const totalCost = Math.round(diffQty * wac * 100) / 100;

    const res = await db.query(
      `INSERT INTO stock_adjustments (
        adjustment_number,
        adjustment_date,
        item_id,
        book_quantity,
        physical_quantity,
        reason,
        adjustment_type,
        batch_number,
        warehouse_id,
        unit_cost,
        total_cost,
        status,
        authorized_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        data.adjustment_number,
        data.adjustment_date,
        data.item_id,
        bookQty,
        physicalQty,
        data.reason,
        data.adjustment_type || 'physical_count',
        data.batch_number || null,
        data.warehouse_id || 'ee000001-0000-0000-0000-000000000001',
        wac,
        totalCost,
        data.status || 'draft',
        data.authorized_by,
      ]
    );

    return res.rows[0];
  },

  /**
   * Post stock adjustment via PostgreSQL atomic function
   */
  async postStockAdjustment(id, userId, client = null) {
    const db = client || { query };
    await db.query(`SELECT fn_post_stock_adjustment($1, $2)`, [id, userId]);
    return this.findAdjustmentById(id, client);
  },

  /**
   * Find stock adjustment by ID
   */
  async findAdjustmentById(id, client = null) {
    const db = client || { query };
    const res = await db.query(
      `SELECT 
        sa.*,
        i.sku,
        i.name AS item_name,
        i.item_type,
        i.base_uom_id,
        w.warehouse_code,
        w.name AS warehouse_name,
        u.username AS authorized_by_username
      FROM stock_adjustments sa
      JOIN items i ON sa.item_id = i.id
      LEFT JOIN warehouses w ON sa.warehouse_id = w.id
      JOIN users u ON sa.authorized_by = u.id
      WHERE sa.id = $1`,
      [id]
    );
    return res.rows[0] || null;
  },

  /**
   * Find list of stock adjustments
   */
  async findAdjustments(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.item_id) {
      values.push(filters.item_id);
      conditions.push(`sa.item_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`sa.status = $${values.length}`);
    }
    if (filters.adjustment_type) {
      values.push(filters.adjustment_type);
      conditions.push(`sa.adjustment_type = $${values.length}`);
    }
    if (filters.from_date) {
      values.push(filters.from_date);
      conditions.push(`sa.adjustment_date >= $${values.length}`);
    }
    if (filters.to_date) {
      values.push(filters.to_date);
      conditions.push(`sa.adjustment_date <= $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM stock_adjustments sa ${whereClause}`,
      values
    );
    const total = countRes.rows[0].total;

    const limit = parseInt(filters.limit, 10) || 20;
    const page = parseInt(filters.page, 10) || 1;
    const offset = (page - 1) * limit;

    values.push(limit, offset);
    const sql = `
      SELECT 
        sa.*,
        i.sku,
        i.name AS item_name,
        i.item_type,
        w.warehouse_code,
        u.username AS authorized_by_username
      FROM stock_adjustments sa
      JOIN items i ON sa.item_id = i.id
      LEFT JOIN warehouses w ON sa.warehouse_id = w.id
      JOIN users u ON sa.authorized_by = u.id
      ${whereClause}
      ORDER BY sa.adjustment_date DESC, sa.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `;

    const rowsRes = await db.query(sql, values);

    return {
      adjustments: rowsRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Find inventory discrepancies between physical and book stock
   */
  async findDiscrepancies(client = null) {
    const db = client || { query };
    const res = await db.query(`
      SELECT 
        sa.id,
        sa.adjustment_number,
        sa.adjustment_date,
        i.sku,
        i.name AS item_name,
        sa.book_quantity,
        sa.physical_quantity,
        sa.discrepancy_quantity,
        sa.unit_cost,
        sa.total_cost,
        sa.adjustment_type,
        sa.status,
        sa.reason
      FROM stock_adjustments sa
      JOIN items i ON sa.item_id = i.id
      WHERE sa.discrepancy_quantity <> 0
      ORDER BY ABS(sa.total_cost) DESC
    `);
    return res.rows;
  },
};
