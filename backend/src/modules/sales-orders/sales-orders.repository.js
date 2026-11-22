import { query, getClient } from '../../config/db.js';

export const salesOrdersRepository = {
  /**
   * Find paginated list of sales orders with customer and salesman details
   */
  async findAll({ page = 1, limit = 20, status, customerId, salesmanId, fromDate, toDate }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`so.status = $${paramIndex++}`);
      params.push(status);
    }
    if (customerId) {
      conditions.push(`so.customer_id = $${paramIndex++}`);
      params.push(customerId);
    }
    if (salesmanId) {
      conditions.push(`so.salesman_id = $${paramIndex++}`);
      params.push(salesmanId);
    }
    if (fromDate) {
      conditions.push(`so.order_date >= $${paramIndex++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`so.order_date <= $${paramIndex++}`);
      params.push(toDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM sales_orders so ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT 
        so.id,
        so.order_number,
        so.customer_id,
        so.salesman_id,
        so.order_date,
        so.offline_client_uuid,
        so.status,
        so.subtotal_amount,
        so.estimated_tax_amount,
        so.total_order_value,
        so.rejection_reason,
        so.notes,
        so.created_at,
        so.updated_at,
        p.trade_name AS customer_name,
        p.state_code AS customer_state_code,
        p.state_name AS customer_state_name,
        u.username AS salesman_username,
        u.full_name AS salesman_name
      FROM sales_orders so
      JOIN parties p ON so.customer_id = p.id
      JOIN users u ON so.salesman_id = u.id
      ${whereClause}
      ORDER BY so.order_date DESC, so.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;

    const dataRes = await query(dataSql, [...params, limit, offset]);

    return {
      salesOrders: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Find sales order by ID with line items
   */
  async findById(id, client = null) {
    const runner = client || { query };
    const orderSql = `
      SELECT 
        so.id,
        so.order_number,
        so.customer_id,
        so.salesman_id,
        so.order_date,
        so.offline_client_uuid,
        so.status,
        so.subtotal_amount,
        so.estimated_tax_amount,
        so.total_order_value,
        so.rejection_reason,
        so.notes,
        so.created_at,
        so.updated_at,
        p.trade_name AS customer_name,
        p.state_code AS customer_state_code,
        p.state_name AS customer_state_name,
        p.gstin AS customer_gstin,
        u.username AS salesman_username,
        u.full_name AS salesman_name
      FROM sales_orders so
      JOIN parties p ON so.customer_id = p.id
      JOIN users u ON so.salesman_id = u.id
      WHERE so.id = $1;
    `;

    const orderRes = await runner.query(orderSql, [id]);
    if (orderRes.rows.length === 0) return null;

    const order = orderRes.rows[0];

    const itemsSql = `
      SELECT 
        soi.id,
        soi.sales_order_id,
        soi.item_id,
        soi.item_name_snapshot,
        soi.hsn_code_snapshot,
        soi.ordered_qty,
        soi.approved_qty,
        soi.uom_id,
        soi.unit_price,
        soi.gst_rate_pct,
        soi.taxable_value,
        soi.total_item_value,
        i.sku AS item_sku,
        i.base_uom_id AS item_base_uom,
        COALESCE(isb.current_base_qty, 0.0000) AS available_stock_base_qty
      FROM sales_order_items soi
      JOIN items i ON soi.item_id = i.id
      LEFT JOIN item_stock_balances isb ON soi.item_id = isb.item_id
      WHERE soi.sales_order_id = $1
      ORDER BY soi.id ASC;
    `;

    const itemsRes = await runner.query(itemsSql, [id]);
    order.items = itemsRes.rows;

    return order;
  },

  /**
   * Find sales order by order number
   */
  async findByOrderNumber(orderNumber) {
    const res = await query('SELECT * FROM sales_orders WHERE order_number = $1;', [orderNumber]);
    return res.rows[0] || null;
  },

  /**
   * Generate next sequential order number: SO-YYYY-XXXX
   */
  async generateOrderNumber(orderDate, client = null) {
    const dateObj = orderDate ? new Date(orderDate) : new Date();
    const year = dateObj.getFullYear();
    const prefix = `SO-${year}-`;

    const runner = client || { query };
    const res = await runner.query(
      `SELECT order_number FROM sales_orders WHERE order_number LIKE $1 ORDER BY order_number DESC LIMIT 1;`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].order_number.match(new RegExp(`^SO-${year}-(\\d+)$`));
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  },

  /**
   * Create sales order with items in a transaction
   */
  async createWithItems(orderData, itemsData, client = null) {
    const shouldManageClient = !client;
    const activeClient = client || (await getClient());

    try {
      if (shouldManageClient) await activeClient.query('BEGIN');

      const insertOrderSql = `
        INSERT INTO sales_orders (
          order_number,
          customer_id,
          salesman_id,
          order_date,
          offline_client_uuid,
          status,
          subtotal_amount,
          estimated_tax_amount,
          total_order_value,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *;
      `;

      const orderRes = await activeClient.query(insertOrderSql, [
        orderData.order_number,
        orderData.customer_id,
        orderData.salesman_id,
        orderData.order_date,
        orderData.offline_client_uuid || null,
        orderData.status || 'submitted',
        orderData.subtotal_amount,
        orderData.estimated_tax_amount,
        orderData.total_order_value,
        orderData.notes || null,
      ]);

      const createdOrder = orderRes.rows[0];

      const createdItems = [];
      for (const item of itemsData) {
        const insertItemSql = `
          INSERT INTO sales_order_items (
            sales_order_id,
            item_id,
            item_name_snapshot,
            hsn_code_snapshot,
            ordered_qty,
            approved_qty,
            uom_id,
            unit_price,
            gst_rate_pct,
            taxable_value,
            total_item_value
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *;
        `;

        const itemRes = await activeClient.query(insertItemSql, [
          createdOrder.id,
          item.item_id,
          item.item_name_snapshot,
          item.hsn_code_snapshot,
          item.ordered_qty,
          item.approved_qty ?? null,
          item.uom_id,
          item.unit_price,
          item.gst_rate_pct,
          item.taxable_value,
          item.total_item_value,
        ]);
        createdItems.push(itemRes.rows[0]);
      }

      if (shouldManageClient) await activeClient.query('COMMIT');

      createdOrder.items = createdItems;
      return createdOrder;
    } catch (err) {
      if (shouldManageClient) await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageClient) activeClient.release();
    }
  },

  /**
   * Update sales order and items
   */
  async updateWithItems(id, orderData, itemsData, client = null) {
    const shouldManageClient = !client;
    const activeClient = client || (await getClient());

    try {
      if (shouldManageClient) await activeClient.query('BEGIN');

      const updateOrderSql = `
        UPDATE sales_orders
        SET subtotal_amount = $1,
            estimated_tax_amount = $2,
            total_order_value = $3,
            notes = $4,
            updated_at = NOW()
        WHERE id = $5
        RETURNING *;
      `;

      const orderRes = await activeClient.query(updateOrderSql, [
        orderData.subtotal_amount,
        orderData.estimated_tax_amount,
        orderData.total_order_value,
        orderData.notes,
        id,
      ]);

      const updatedOrder = orderRes.rows[0];

      if (itemsData && itemsData.length > 0) {
        // Delete existing items
        await activeClient.query('DELETE FROM sales_order_items WHERE sales_order_id = $1;', [id]);

        const updatedItems = [];
        for (const item of itemsData) {
          const insertItemSql = `
            INSERT INTO sales_order_items (
              sales_order_id,
              item_id,
              item_name_snapshot,
              hsn_code_snapshot,
              ordered_qty,
              approved_qty,
              uom_id,
              unit_price,
              gst_rate_pct,
              taxable_value,
              total_item_value
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *;
          `;

          const itemRes = await activeClient.query(insertItemSql, [
            id,
            item.item_id,
            item.item_name_snapshot,
            item.hsn_code_snapshot,
            item.ordered_qty,
            item.approved_qty ?? null,
            item.uom_id,
            item.unit_price,
            item.gst_rate_pct,
            item.taxable_value,
            item.total_item_value,
          ]);
          updatedItems.push(itemRes.rows[0]);
        }
        updatedOrder.items = updatedItems;
      }

      if (shouldManageClient) await activeClient.query('COMMIT');
      return updatedOrder;
    } catch (err) {
      if (shouldManageClient) await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageClient) activeClient.release();
    }
  },

  /**
   * Update status with optional fields (e.g. rejection_reason)
   */
  async updateStatus(id, status, extraFields = {}, client = null) {
    const runner = client || { query };
    const fields = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    let paramIndex = 2;

    if (extraFields.rejection_reason !== undefined) {
      fields.push(`rejection_reason = $${paramIndex++}`);
      params.push(extraFields.rejection_reason);
    }

    params.push(id);
    const sql = `
      UPDATE sales_orders
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *;
    `;

    const res = await runner.query(sql, params);
    return res.rows[0] || null;
  },

  /**
   * Update approved quantities on order items
   */
  async updateApprovedQuantities(id, itemApprovedQtys, client = null) {
    const runner = client || { query };
    for (const { itemId, approvedQty } of itemApprovedQtys) {
      await runner.query(
        `UPDATE sales_order_items SET approved_qty = $1 WHERE sales_order_id = $2 AND item_id = $3;`,
        [approvedQty, id, itemId]
      );
    }
  },

  /**
   * Delete sales order (only for draft/submitted unlinked orders)
   */
  async delete(id) {
    const res = await query('DELETE FROM sales_orders WHERE id = $1 RETURNING *;', [id]);
    return res.rows[0] || null;
  },
};
