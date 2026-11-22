import { query, getClient } from '../../config/db.js';

export const dispatchesRepository = {
  /**
   * Find paginated list of dispatches
   */
  async findAll({ page = 1, limit = 20, status, invoiceId, fromDate, toDate }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`d.status = $${paramIndex++}`);
      params.push(status);
    }
    if (invoiceId) {
      conditions.push(`d.invoice_id = $${paramIndex++}`);
      params.push(invoiceId);
    }
    if (fromDate) {
      conditions.push(`d.dispatch_date >= $${paramIndex++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`d.dispatch_date <= $${paramIndex++}`);
      params.push(toDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM dispatches d ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT 
        d.id,
        d.dispatch_number,
        d.invoice_id,
        d.dispatch_date,
        d.carrier_or_vehicle_no,
        d.driver_name,
        d.status,
        d.dispatched_by,
        d.created_at,
        inv.invoice_number,
        inv.total_invoice_value,
        p.trade_name AS customer_name,
        p.state_name AS customer_state_name,
        u.username AS dispatched_by_username,
        u.full_name AS dispatched_by_name
      FROM dispatches d
      JOIN invoices inv ON d.invoice_id = inv.id
      JOIN parties p ON inv.customer_id = p.id
      JOIN users u ON d.dispatched_by = u.id
      ${whereClause}
      ORDER BY d.dispatch_date DESC, d.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;

    const dataRes = await query(dataSql, [...params, limit, offset]);

    return {
      dispatches: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Find dispatch by ID with line items
   */
  async findById(id, client = null) {
    const runner = client || { query };
    const dispatchSql = `
      SELECT 
        d.id,
        d.dispatch_number,
        d.invoice_id,
        d.dispatch_date,
        d.carrier_or_vehicle_no,
        d.driver_name,
        d.status,
        d.dispatched_by,
        d.created_at,
        inv.invoice_number,
        inv.sales_order_id,
        inv.customer_id,
        inv.invoice_date,
        inv.taxable_value AS invoice_taxable_value,
        inv.total_invoice_value,
        p.trade_name AS customer_name,
        p.state_code AS customer_state_code,
        p.state_name AS customer_state_name,
        p.shipping_address AS customer_shipping_address,
        u.username AS dispatched_by_username,
        u.full_name AS dispatched_by_name
      FROM dispatches d
      JOIN invoices inv ON d.invoice_id = inv.id
      JOIN parties p ON inv.customer_id = p.id
      JOIN users u ON d.dispatched_by = u.id
      WHERE d.id = $1;
    `;

    const dispatchRes = await runner.query(dispatchSql, [id]);
    if (dispatchRes.rows.length === 0) return null;

    const dispatch = dispatchRes.rows[0];

    const itemsSql = `
      SELECT 
        di.id,
        di.dispatch_id,
        di.item_id,
        di.batch_number,
        di.dispatched_qty,
        di.uom_id,
        di.base_quantity,
        i.sku AS item_sku,
        i.name AS item_name,
        i.base_uom_id AS item_base_uom,
        COALESCE(isb.current_base_qty, 0.0000) AS current_stock_qty,
        COALESCE(isb.current_moving_wac, 0.0000) AS current_moving_wac
      FROM dispatch_items di
      JOIN items i ON di.item_id = i.id
      LEFT JOIN item_stock_balances isb ON di.item_id = isb.item_id
      WHERE di.dispatch_id = $1
      ORDER BY di.id ASC;
    `;

    const itemsRes = await runner.query(itemsSql, [id]);
    dispatch.items = itemsRes.rows;

    return dispatch;
  },

  /**
   * Find dispatch by dispatch number
   */
  async findByDispatchNumber(dispatchNumber) {
    const res = await query('SELECT * FROM dispatches WHERE dispatch_number = $1;', [dispatchNumber]);
    return res.rows[0] || null;
  },

  /**
   * Find dispatch by invoice ID
   */
  async findByInvoiceId(invoiceId) {
    const res = await query('SELECT * FROM dispatches WHERE invoice_id = $1;', [invoiceId]);
    return res.rows[0] || null;
  },

  /**
   * Generate next sequential dispatch number: DSP-YYYY-XXXX
   */
  async generateDispatchNumber(dispatchDate, client = null) {
    const dateObj = dispatchDate ? new Date(dispatchDate) : new Date();
    const year = dateObj.getFullYear();
    const prefix = `DSP-${year}-`;

    const runner = client || { query };
    const res = await runner.query(
      `SELECT dispatch_number FROM dispatches WHERE dispatch_number LIKE $1 ORDER BY dispatch_number DESC LIMIT 1;`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].dispatch_number.match(new RegExp(`^DSP-${year}-(\\d+)$`));
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  },

  /**
   * Create dispatch with items in a transaction
   */
  async createWithItems(dispatchData, itemsData, client = null) {
    const shouldManageClient = !client;
    const activeClient = client || (await getClient());

    try {
      if (shouldManageClient) await activeClient.query('BEGIN');

      const insertDispatchSql = `
        INSERT INTO dispatches (
          dispatch_number,
          invoice_id,
          dispatch_date,
          carrier_or_vehicle_no,
          driver_name,
          status,
          dispatched_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `;

      const dispatchRes = await activeClient.query(insertDispatchSql, [
        dispatchData.dispatch_number,
        dispatchData.invoice_id,
        dispatchData.dispatch_date,
        dispatchData.carrier_or_vehicle_no || null,
        dispatchData.driver_name || null,
        dispatchData.status || 'ready',
        dispatchData.dispatched_by,
      ]);

      const createdDispatch = dispatchRes.rows[0];

      const createdItems = [];
      for (const item of itemsData) {
        const insertItemSql = `
          INSERT INTO dispatch_items (
            dispatch_id,
            item_id,
            batch_number,
            dispatched_qty,
            uom_id,
            base_quantity
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *;
        `;

        const itemRes = await activeClient.query(insertItemSql, [
          createdDispatch.id,
          item.item_id,
          item.batch_number,
          item.dispatched_qty,
          item.uom_id,
          item.base_quantity,
        ]);
        createdItems.push(itemRes.rows[0]);
      }

      if (shouldManageClient) await activeClient.query('COMMIT');

      createdDispatch.items = createdItems;
      return createdDispatch;
    } catch (err) {
      if (shouldManageClient) await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageClient) activeClient.release();
    }
  },

  /**
   * Execute atomic PostgreSQL posting engine: fn_post_sales_dispatch
   */
  async executePostingEngine(dispatchId, userId) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT fn_post_sales_dispatch($1, $2);`, [dispatchId, userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Update dispatch status
   */
  async updateStatus(id, status, client = null) {
    const runner = client || { query };
    const res = await runner.query(
      `UPDATE dispatches SET status = $1 WHERE id = $2 RETURNING *;`,
      [status, id]
    );
    return res.rows[0] || null;
  },

  /**
   * Calculate Cost of Goods Sold (COGS) and Gross Margin
   */
  async getCogsAndMargin(dispatchId) {
    const sql = `
      SELECT 
        d.id AS dispatch_id,
        d.dispatch_number,
        d.dispatch_date,
        d.status AS dispatch_status,
        inv.id AS invoice_id,
        inv.invoice_number,
        inv.taxable_value AS taxable_revenue,
        inv.total_invoice_value,
        COALESCE(SUM(ABS(il.total_cost)), 0.00) AS cogs_total,
        ROUND(inv.taxable_value - COALESCE(SUM(ABS(il.total_cost)), 0.00), 2) AS gross_profit,
        CASE 
          WHEN inv.taxable_value > 0 THEN 
            ROUND(((inv.taxable_value - COALESCE(SUM(ABS(il.total_cost)), 0.00)) / inv.taxable_value) * 100.0, 2)
          ELSE 0.00
        END AS gross_margin_pct
      FROM dispatches d
      JOIN invoices inv ON d.invoice_id = inv.id
      JOIN dispatch_items di ON d.id = di.dispatch_id
      LEFT JOIN inventory_ledger il ON di.id = il.dispatch_item_id
      WHERE d.id = $1
      GROUP BY d.id, d.dispatch_number, d.dispatch_date, d.status, inv.id, inv.invoice_number, inv.taxable_value, inv.total_invoice_value;
    `;

    const res = await query(sql, [dispatchId]);
    if (res.rows.length === 0) return null;

    const summary = res.rows[0];

    // Detailed ledger movements for each dispatched item
    const itemDetailsSql = `
      SELECT 
        di.id AS dispatch_item_id,
        di.item_id,
        i.sku,
        i.name AS item_name,
        di.batch_number,
        di.dispatched_qty,
        di.uom_id,
        di.base_quantity,
        il.unit_cost AS moving_wac_unit_cost,
        ABS(il.total_cost) AS line_item_cogs
      FROM dispatch_items di
      JOIN items i ON di.item_id = i.id
      LEFT JOIN inventory_ledger il ON di.id = il.dispatch_item_id
      WHERE di.dispatch_id = $1
      ORDER BY di.id ASC;
    `;

    const itemsRes = await query(itemDetailsSql, [dispatchId]);
    summary.items = itemsRes.rows;

    return summary;
  },
};
