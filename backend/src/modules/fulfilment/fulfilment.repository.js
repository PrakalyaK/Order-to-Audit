import { query } from '../../config/db.js';

export const fulfilmentRepository = {
  /**
   * Find orders for fulfilment dashboard with filtering by tab, pagination & search
   */
  async findFulfilmentOrders(params = {}, client = null) {
    const runner = client || { query };
    const { tab, search, page = 1, limit = 20 } = params;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const conditions = [];
    const values = [];

    // Filter by tab
    if (tab === 'ready_to_dispatch') {
      conditions.push(`v.shortage_qty = 0 AND v.remaining_qty > 0`);
    } else if (tab === 'stock_shortage') {
      conditions.push(`v.shortage_qty > 0`);
    }

    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(v.order_number ILIKE $${values.length} OR v.customer_name ILIKE $${values.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Grouping by sales order so each order appears once with aggregated quantities
    const sql = `
      WITH order_summary AS (
        SELECT 
          v.sales_order_id,
          v.order_number,
          v.order_date,
          v.order_status,
          v.customer_id,
          v.customer_name,
          v.customer_state_name,
          SUM(v.ordered_qty) AS total_ordered_qty,
          SUM(v.already_dispatched_qty) AS total_dispatched_qty,
          SUM(v.remaining_qty) AS total_remaining_qty,
          MIN(v.available_stock_qty) AS min_available_stock_qty,
          SUM(v.shortage_qty) AS total_shortage_qty,
          CASE 
            WHEN SUM(v.remaining_qty) <= 0 THEN 'fulfilled'
            WHEN SUM(v.shortage_qty) = 0 THEN 'ready_to_dispatch'
            WHEN SUM(v.shortage_qty) < SUM(v.remaining_qty) THEN 'partially_available'
            ELSE 'stock_shortage'
          END AS fulfilment_status,
          (
            SELECT pr.id 
            FROM production_requirements pr 
            WHERE pr.sales_order_id = v.sales_order_id 
              AND pr.status IN ('pending', 'pending_production_review', 'scheduled', 'awaiting_materials', 'in_production', 'partially_fulfilled')
            LIMIT 1
          ) AS active_production_requirement_id
        FROM v_sales_order_fulfilment v
        ${whereClause}
        GROUP BY v.sales_order_id, v.order_number, v.order_date, v.order_status, v.customer_id, v.customer_name, v.customer_state_name
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM order_summary
      ORDER BY order_date DESC, order_number DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2};
    `;

    values.push(parseInt(limit, 10), offset);
    const res = await runner.query(sql, values);

    const totalCount = res.rows[0]?.total_count || 0;
    return {
      orders: res.rows,
      pagination: {
        total: totalCount,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalCount / parseInt(limit, 10)),
      },
    };
  },

  /**
   * Get fulfilment summary metrics
   */
  async getFulfilmentSummary(client = null) {
    const runner = client || { query };
    const sql = `
      WITH order_agg AS (
        SELECT 
          v.sales_order_id,
          SUM(v.remaining_qty) AS remaining,
          SUM(v.shortage_qty) AS shortage
        FROM v_sales_order_fulfilment v
        GROUP BY v.sales_order_id
      )
      SELECT 
        COUNT(*)::int AS total_approved_orders,
        COUNT(CASE WHEN remaining > 0 AND shortage = 0 THEN 1 END)::int AS ready_to_dispatch_count,
        COUNT(CASE WHEN shortage > 0 THEN 1 END)::int AS stock_shortage_count,
        (
          SELECT COUNT(*)::int 
          FROM production_requirements 
          WHERE status IN ('pending', 'pending_production_review', 'scheduled', 'awaiting_materials', 'in_production', 'partially_fulfilled')
        ) AS pending_production_requirements
      FROM order_agg;
    `;
    const res = await runner.query(sql);
    return res.rows[0] || {
      total_approved_orders: 0,
      ready_to_dispatch_count: 0,
      stock_shortage_count: 0,
      pending_production_requirements: 0,
    };
  },

  /**
   * Find single order fulfilment lines with stock availability
   */
  async findSalesOrderFulfilment(salesOrderId, client = null) {
    const runner = client || { query };
    const sql = `
      SELECT * 
      FROM v_sales_order_fulfilment 
      WHERE sales_order_id = $1 
      ORDER BY product_name ASC;
    `;
    const res = await runner.query(sql, [salesOrderId]);
    return res.rows;
  },

  /**
   * Generate next sequential requirement number (e.g. PRQ-2026-0001)
   */
  async generateRequirementNumber(client = null) {
    const runner = client || { query };
    const year = new Date().getFullYear();
    const prefix = `PRQ-${year}-`;
    const res = await runner.query(
      `SELECT requirement_number FROM production_requirements 
       WHERE requirement_number LIKE $1 
       ORDER BY requirement_number DESC LIMIT 1;`,
      [`${prefix}%`]
    );
    let nextSeq = 1;
    if (res.rows.length > 0) {
      const parts = res.rows[0].requirement_number.split('-');
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
    }
    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  },

  /**
   * Upsert active production requirement for a sales order and product
   */
  async upsertProductionRequirement(data, client = null) {
    const runner = client || { query };
    const existing = await this.findActiveRequirement(data.sales_order_id, data.product_id, runner);

    if (existing) {
      // Update existing requirement
      const updateSql = `
        UPDATE production_requirements 
        SET required_qty = $1,
            production_qty_required = $2,
            notes = COALESCE($3, notes),
            updated_at = NOW()
        WHERE id = $4
        RETURNING *;
      `;
      const res = await runner.query(updateSql, [
        data.required_qty,
        data.production_qty_required,
        data.notes || null,
        existing.id,
      ]);
      return { requirement: res.rows[0], isNew: false };
    }

    // Insert new requirement
    const reqNumber = await this.generateRequirementNumber(runner);
    const insertSql = `
      INSERT INTO production_requirements (
        requirement_number, sales_order_id, product_id,
        required_qty, available_qty_at_creation, production_qty_required,
        status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;
    const res = await runner.query(insertSql, [
      reqNumber,
      data.sales_order_id,
      data.product_id,
      data.required_qty,
      data.available_qty_at_creation || 0,
      data.production_qty_required,
      'pending_production_review',
      data.notes || null,
    ]);
    return { requirement: res.rows[0], isNew: true };
  },

  /**
   * Find active production requirement for a sales order and product
   */
  async findActiveRequirement(salesOrderId, productId, client = null) {
    const runner = client || { query };
    const sql = `
      SELECT * FROM production_requirements 
      WHERE sales_order_id = $1 
        AND product_id = $2 
        AND status IN ('pending', 'pending_production_review', 'scheduled', 'awaiting_materials', 'in_production', 'partially_fulfilled')
      LIMIT 1;
    `;
    const res = await runner.query(sql, [salesOrderId, productId]);
    return res.rows[0] || null;
  },

  /**
   * Find production requirements list with optional filters
   */
  async findProductionRequirements(filters = {}, client = null) {
    const runner = client || { query };
    const { status, salesOrderId, productId, page = 1, limit = 20 } = filters;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    const conditions = [];
    const values = [];

    if (status) {
      values.push(status);
      conditions.push(`pr.status = $${values.length}`);
    }
    if (salesOrderId) {
      values.push(salesOrderId);
      conditions.push(`pr.sales_order_id = $${values.length}`);
    }
    if (productId) {
      values.push(productId);
      conditions.push(`pr.product_id = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT 
        pr.*,
        so.order_number AS sales_order_number,
        so.order_date AS sales_order_date,
        p.trade_name AS customer_name,
        it.name AS product_name,
        it.sku AS product_sku,
        it.base_uom_id AS uom_id,
        b.bom_code,
        COUNT(*) OVER()::int AS total_count
      FROM production_requirements pr
      LEFT JOIN sales_orders so ON pr.sales_order_id = so.id
      LEFT JOIN parties p ON so.customer_id = p.id
      LEFT JOIN items it ON pr.product_id = it.id
      LEFT JOIN boms b ON b.finished_good_item_id = it.id AND b.is_active = TRUE
      ${whereClause}
      ORDER BY pr.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2};
    `;

    values.push(parseInt(limit, 10), offset);
    const res = await runner.query(sql, values);
    const totalCount = res.rows[0]?.total_count || 0;

    return {
      requirements: res.rows,
      pagination: {
        total: totalCount,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalCount / parseInt(limit, 10)),
      },
    };
  },

  /**
   * Find production requirement by ID
   */
  async findProductionRequirementById(id, client = null) {
    const runner = client || { query };
    const sql = `
      SELECT 
        pr.*,
        so.order_number AS sales_order_number,
        so.order_date AS sales_order_date,
        p.trade_name AS customer_name,
        it.name AS product_name,
        it.sku AS product_sku,
        it.base_uom_id AS uom_id
      FROM production_requirements pr
      LEFT JOIN sales_orders so ON pr.sales_order_id = so.id
      LEFT JOIN parties p ON so.customer_id = p.id
      LEFT JOIN items it ON pr.product_id = it.id
      WHERE pr.id = $1;
    `;
    const res = await runner.query(sql, [id]);
    return res.rows[0] || null;
  },

  /**
   * Update production requirement status and execution references
   */
  async updateRequirementStatus(id, status, extraFields = {}, client = null) {
    const runner = client || { query };
    const sets = ['status = $2', 'updated_at = NOW()'];
    const values = [id, status];

    if (extraFields.fulfilled_qty !== undefined) {
      values.push(extraFields.fulfilled_qty);
      sets.push(`fulfilled_qty = $${values.length}`);
    }
    if (extraFields.production_qty_required !== undefined) {
      values.push(extraFields.production_qty_required);
      sets.push(`production_qty_required = $${values.length}`);
    }
    if (extraFields.production_run_id !== undefined) {
      values.push(extraFields.production_run_id);
      sets.push(`production_run_id = $${values.length}`);
    }

    const sql = `UPDATE production_requirements SET ${sets.join(', ')} WHERE id = $1 RETURNING *;`;
    const res = await runner.query(sql, values);
    return res.rows[0] || null;
  },

  /**
   * Create procurement requirement for raw material shortage
   */
  async createProcurementRequirement(data, client = null) {
    const runner = client || { query };
    const year = new Date().getFullYear();
    const prefix = `MAT-REQ-${year}-`;
    const numRes = await runner.query(
      `SELECT requirement_number FROM procurement_requirements WHERE requirement_number LIKE $1 ORDER BY requirement_number DESC LIMIT 1;`,
      [`${prefix}%`]
    );
    let nextSeq = 1;
    if (numRes.rows.length > 0) {
      const parts = numRes.rows[0].requirement_number.split('-');
      const lastSeq = parseInt(parts[3] || parts[2], 10);
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
    }
    const reqNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

    const sql = `
      INSERT INTO procurement_requirements (
        requirement_number, production_requirement_id, sales_order_id,
        material_item_id, shortage_qty, uom_id,
        estimated_rate, estimated_total, suggested_supplier_id,
        purchase_id, status, created_by, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;

    const res = await runner.query(sql, [
      reqNumber,
      data.production_requirement_id,
      data.sales_order_id || null,
      data.material_item_id,
      data.shortage_qty,
      data.uom_id,
      data.estimated_rate || 0,
      data.estimated_total || 0,
      data.suggested_supplier_id || null,
      data.purchase_id || null,
      'pending',
      data.created_by || null,
      data.notes || null,
    ]);
    return res.rows[0];
  },

  /**
   * Find procurement requirements linked to a production requirement
   */
  async findProcurementRequirementsByProductionReqId(prodReqId, client = null) {
    const runner = client || { query };
    const sql = `
      SELECT pr.*, it.name AS material_name, it.sku AS material_sku, p.trade_name AS supplier_name
      FROM procurement_requirements pr
      JOIN items it ON pr.material_item_id = it.id
      LEFT JOIN parties p ON pr.suggested_supplier_id = p.id
      WHERE pr.production_requirement_id = $1
      ORDER BY pr.created_at ASC;
    `;
    const res = await runner.query(sql, [prodReqId]);
    return res.rows;
  },

  /**
   * Create In-App Notification
   */
  async createNotification(data, client = null) {
    const runner = client || { query };
    const sql = `
      INSERT INTO in_app_notifications (
        recipient_role, recipient_user_id, title, message, entity_type, entity_id, action_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const res = await runner.query(sql, [
      data.recipient_role || null,
      data.recipient_user_id || null,
      data.title,
      data.message,
      data.entity_type || null,
      data.entity_id || null,
      data.action_url || null,
    ]);
    return res.rows[0];
  },

  /**
   * Find notifications for a role/user
   */
  async findNotifications(role, userId, limit = 20, client = null) {
    const runner = client || { query };
    const sql = `
      SELECT * FROM in_app_notifications
      WHERE (recipient_role = $1 OR recipient_user_id = $2 OR recipient_role IS NULL)
      ORDER BY created_at DESC
      LIMIT $3;
    `;
    const res = await runner.query(sql, [role, userId, parseInt(limit, 10)]);
    return res.rows;
  },

  /**
   * Mark notification as read
   */
  async markNotificationRead(id, client = null) {
    const runner = client || { query };
    const sql = `UPDATE in_app_notifications SET is_read = TRUE WHERE id = $1 RETURNING *;`;
    const res = await runner.query(sql, [id]);
    return res.rows[0] || null;
  },

  /**
   * Mark all notifications as read for a role/user
   */
  async markAllNotificationsRead(role, userId, client = null) {
    const runner = client || { query };
    const sql = `
      UPDATE in_app_notifications 
      SET is_read = TRUE 
      WHERE (recipient_role = $1 OR recipient_user_id = $2 OR recipient_role IS NULL)
        AND is_read = FALSE;
    `;
    await runner.query(sql, [role, userId]);
  },
};
