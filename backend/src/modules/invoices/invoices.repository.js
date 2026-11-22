import { query, getClient } from '../../config/db.js';

export const invoicesRepository = {
  /**
   * Find paginated list of invoices with customer and order details
   */
  async findAll({ page = 1, limit = 20, status, customerId, salesOrderId, financialYear, isInterstate, fromDate, toDate }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`inv.status = $${paramIndex++}`);
      params.push(status);
    }
    if (customerId) {
      conditions.push(`inv.customer_id = $${paramIndex++}`);
      params.push(customerId);
    }
    if (salesOrderId) {
      conditions.push(`inv.sales_order_id = $${paramIndex++}`);
      params.push(salesOrderId);
    }
    if (financialYear) {
      conditions.push(`inv.financial_year = $${paramIndex++}`);
      params.push(financialYear);
    }
    if (isInterstate !== undefined) {
      conditions.push(`inv.is_interstate = $${paramIndex++}`);
      params.push(isInterstate);
    }
    if (fromDate) {
      conditions.push(`inv.invoice_date >= $${paramIndex++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`inv.invoice_date <= $${paramIndex++}`);
      params.push(toDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM invoices inv ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT 
        inv.id,
        inv.invoice_number,
        inv.financial_year,
        inv.sales_order_id,
        inv.customer_id,
        inv.invoice_date,
        inv.place_of_supply_state_code,
        inv.is_interstate,
        inv.taxable_value,
        inv.cgst_amount,
        inv.sgst_amount,
        inv.igst_amount,
        inv.total_invoice_value,
        inv.status,
        inv.pdf_storage_path,
        inv.approved_by,
        inv.created_at,
        p.trade_name AS customer_name,
        p.state_name AS customer_state_name,
        p.gstin AS customer_gstin,
        so.order_number,
        u.username AS approved_by_username,
        u.full_name AS approved_by_name
      FROM invoices inv
      JOIN parties p ON inv.customer_id = p.id
      JOIN sales_orders so ON inv.sales_order_id = so.id
      JOIN users u ON inv.approved_by = u.id
      ${whereClause}
      ORDER BY inv.invoice_date DESC, inv.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;

    const dataRes = await query(dataSql, [...params, limit, offset]);

    return {
      invoices: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Find invoice by ID with line items
   */
  async findById(id, client = null) {
    const runner = client || { query };
    const invoiceSql = `
      SELECT 
        inv.id,
        inv.invoice_number,
        inv.financial_year,
        inv.sales_order_id,
        inv.customer_id,
        inv.invoice_date,
        inv.place_of_supply_state_code,
        inv.is_interstate,
        inv.taxable_value,
        inv.cgst_amount,
        inv.sgst_amount,
        inv.igst_amount,
        inv.total_invoice_value,
        inv.status,
        inv.pdf_storage_path,
        inv.approved_by,
        inv.created_at,
        p.trade_name AS customer_name,
        p.state_code AS customer_state_code,
        p.state_name AS customer_state_name,
        p.gstin AS customer_gstin,
        p.billing_address AS customer_billing_address,
        so.order_number,
        u.username AS approved_by_username,
        u.full_name AS approved_by_name
      FROM invoices inv
      JOIN parties p ON inv.customer_id = p.id
      JOIN sales_orders so ON inv.sales_order_id = so.id
      JOIN users u ON inv.approved_by = u.id
      WHERE inv.id = $1;
    `;

    const invoiceRes = await runner.query(invoiceSql, [id]);
    if (invoiceRes.rows.length === 0) return null;

    const invoice = invoiceRes.rows[0];

    const itemsSql = `
      SELECT 
        ii.id,
        ii.invoice_id,
        ii.item_id,
        ii.item_name_snapshot,
        ii.hsn_code_snapshot,
        ii.quantity,
        ii.uom_id,
        ii.base_quantity,
        ii.unit_price,
        ii.taxable_value,
        ii.gst_rate_pct,
        ii.cgst_rate_pct,
        ii.cgst_amount,
        ii.sgst_rate_pct,
        ii.sgst_amount,
        ii.igst_rate_pct,
        ii.igst_amount,
        ii.total_item_value,
        i.sku AS item_sku
      FROM invoice_items ii
      JOIN items i ON ii.item_id = i.id
      WHERE ii.invoice_id = $1
      ORDER BY ii.id ASC;
    `;

    const itemsRes = await runner.query(itemsSql, [id]);
    invoice.items = itemsRes.rows;

    return invoice;
  },

  /**
   * Find existing active invoice for sales order
   */
  async findBySalesOrderId(salesOrderId, client = null) {
    const runner = client || { query };
    const res = await runner.query(
      `SELECT * FROM invoices WHERE sales_order_id = $1 AND status <> 'cancelled';`,
      [salesOrderId]
    );
    return res.rows[0] || null;
  },

  /**
   * Find by invoice number
   */
  async findByInvoiceNumber(invoiceNumber) {
    const res = await query('SELECT * FROM invoices WHERE invoice_number = $1;', [invoiceNumber]);
    return res.rows[0] || null;
  },

  /**
   * Generate next sequential invoice number: INV/YYYY-YY/XXXX
   */
  async generateInvoiceNumber(financialYear, client = null) {
    const prefix = `INV/${financialYear}/`;
    const runner = client || { query };
    const res = await runner.query(
      `SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY invoice_number DESC LIMIT 1;`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].invoice_number.match(new RegExp(`^INV/${financialYear}/(\\d+)$`));
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  },

  /**
   * Create invoice and items in a single transaction, updating sales order status
   */
  async createWithItems(invoiceData, itemsData, client = null) {
    const shouldManageClient = !client;
    const activeClient = client || (await getClient());

    try {
      if (shouldManageClient) await activeClient.query('BEGIN');

      const insertInvoiceSql = `
        INSERT INTO invoices (
          invoice_number,
          financial_year,
          sales_order_id,
          customer_id,
          invoice_date,
          place_of_supply_state_code,
          is_interstate,
          taxable_value,
          cgst_amount,
          sgst_amount,
          igst_amount,
          total_invoice_value,
          status,
          approved_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *;
      `;

      const invoiceRes = await activeClient.query(insertInvoiceSql, [
        invoiceData.invoice_number,
        invoiceData.financial_year,
        invoiceData.sales_order_id,
        invoiceData.customer_id,
        invoiceData.invoice_date,
        invoiceData.place_of_supply_state_code,
        invoiceData.is_interstate,
        invoiceData.taxable_value,
        invoiceData.cgst_amount,
        invoiceData.sgst_amount,
        invoiceData.igst_amount,
        invoiceData.total_invoice_value,
        invoiceData.status || 'posted',
        invoiceData.approved_by,
      ]);

      const createdInvoice = invoiceRes.rows[0];

      const createdItems = [];
      for (const item of itemsData) {
        const insertItemSql = `
          INSERT INTO invoice_items (
            invoice_id,
            item_id,
            item_name_snapshot,
            hsn_code_snapshot,
            quantity,
            uom_id,
            base_quantity,
            unit_price,
            taxable_value,
            gst_rate_pct,
            cgst_rate_pct,
            cgst_amount,
            sgst_rate_pct,
            sgst_amount,
            igst_rate_pct,
            igst_amount,
            total_item_value
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING *;
        `;

        const itemRes = await activeClient.query(insertItemSql, [
          createdInvoice.id,
          item.item_id,
          item.item_name_snapshot,
          item.hsn_code_snapshot,
          item.quantity,
          item.uom_id,
          item.base_quantity,
          item.unit_price,
          item.taxable_value,
          item.gst_rate_pct,
          item.cgst_rate_pct,
          item.cgst_amount,
          item.sgst_rate_pct,
          item.sgst_amount,
          item.igst_rate_pct,
          item.igst_amount,
          item.total_item_value,
        ]);
        createdItems.push(itemRes.rows[0]);
      }

      // If invoice is posted, update sales order status to 'invoiced'
      if (createdInvoice.status === 'posted') {
        await activeClient.query(
          `UPDATE sales_orders SET status = 'invoiced', updated_at = NOW() WHERE id = $1;`,
          [createdInvoice.sales_order_id]
        );
      }

      if (shouldManageClient) await activeClient.query('COMMIT');

      createdInvoice.items = createdItems;
      return createdInvoice;
    } catch (err) {
      if (shouldManageClient) await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageClient) activeClient.release();
    }
  },

  /**
   * Update status (e.g. cancelled)
   */
  async updateStatus(id, status, client = null) {
    const runner = client || { query };
    const res = await runner.query(
      `UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *;`,
      [status, id]
    );
    return res.rows[0] || null;
  },

  /**
   * Query GSTR-1 / GSTR-3B Outward Supplies Register view
   */
  async getGstOutwardSummary({ financialYear, taxPeriod } = {}) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (financialYear) {
      conditions.push(`financial_year = $${paramIndex++}`);
      params.push(financialYear);
    }
    if (taxPeriod) {
      conditions.push(`tax_period = $${paramIndex++}`);
      params.push(taxPeriod);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM v_gst_outward_summary ${whereClause};`;
    const res = await query(sql, params);
    return res.rows;
  },

  /**
   * Query Customer Receivables & Outstanding view
   */
  async getCustomerOutstanding({ customerId } = {}) {
    if (customerId) {
      const res = await query(`SELECT * FROM v_customer_outstanding WHERE customer_id = $1;`, [customerId]);
      return res.rows[0] || null;
    }
    const res = await query(`SELECT * FROM v_customer_outstanding ORDER BY total_billed DESC;`);
    return res.rows;
  },

  /**
   * Query Invoice Balances view
   */
  async getInvoiceBalances({ customerId, invoiceId } = {}) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (customerId) {
      conditions.push(`customer_id = $${paramIndex++}`);
      params.push(customerId);
    }
    if (invoiceId) {
      conditions.push(`invoice_id = $${paramIndex++}`);
      params.push(invoiceId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await query(`SELECT * FROM v_invoice_balances ${whereClause} ORDER BY invoice_date DESC;`, params);
    return res.rows;
  },
};
