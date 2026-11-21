import { query, getClient } from '../../config/db.js';

export const purchasesRepository = {
  /**
   * Find paginated purchase bills with supplier details
   */
  async findAll({ page = 1, limit = 20, status, supplier_id, search, from_date, to_date }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`pb.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (supplier_id) {
      conditions.push(`pb.supplier_id = $${paramIndex}`);
      params.push(supplier_id);
      paramIndex++;
    }

    if (search) {
      conditions.push(`(pb.bill_number ILIKE $${paramIndex} OR p.trade_name ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (from_date) {
      conditions.push(`pb.bill_date >= $${paramIndex}`);
      params.push(from_date);
      paramIndex++;
    }

    if (to_date) {
      conditions.push(`pb.bill_date <= $${paramIndex}`);
      params.push(to_date);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*) AS total
      FROM purchase_bills pb
      JOIN parties p ON pb.supplier_id = p.id
      ${whereClause};
    `;
    const countRes = await query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    const dataSql = `
      SELECT 
        pb.id, pb.supplier_id, pb.bill_number, pb.bill_date,
        pb.subtotal_amount, pb.cgst_amount, pb.sgst_amount, pb.igst_amount, pb.total_amount,
        pb.status, pb.received_by, pb.notes, pb.created_at,
        p.trade_name AS supplier_name, p.gstin AS supplier_gstin, p.state_code AS supplier_state_code,
        u.username AS received_by_username, u.full_name AS received_by_name,
        (SELECT COUNT(*) FROM purchase_bill_items pbi WHERE pbi.purchase_bill_id = pb.id) AS items_count
      FROM purchase_bills pb
      JOIN parties p ON pb.supplier_id = p.id
      JOIN users u ON pb.received_by = u.id
      ${whereClause}
      ORDER BY pb.bill_date DESC, pb.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    params.push(limit, offset);

    const dataRes = await query(dataSql, params);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      purchases: dataRes.rows,
    };
  },

  /**
   * Find purchase bill by ID including supplier and all line items
   */
  async findById(id) {
    const billSql = `
      SELECT 
        pb.id, pb.supplier_id, pb.bill_number, pb.bill_date,
        pb.subtotal_amount, pb.cgst_amount, pb.sgst_amount, pb.igst_amount, pb.total_amount,
        pb.status, pb.received_by, pb.notes, pb.created_at,
        p.trade_name AS supplier_name, p.gstin AS supplier_gstin, p.state_code AS supplier_state_code,
        p.billing_address AS supplier_address,
        u.username AS received_by_username, u.full_name AS received_by_name
      FROM purchase_bills pb
      JOIN parties p ON pb.supplier_id = p.id
      JOIN users u ON pb.received_by = u.id
      WHERE pb.id = $1;
    `;
    const billRes = await query(billSql, [id]);
    if (billRes.rows.length === 0) return null;

    const bill = billRes.rows[0];

    const itemsSql = `
      SELECT 
        pbi.id, pbi.purchase_bill_id, pbi.item_id, pbi.supplier_batch_no, pbi.expiry_date,
        pbi.quantity, pbi.uom_id, pbi.base_quantity, pbi.unit_rate, pbi.taxable_amount,
        pbi.gst_rate_pct, pbi.tax_amount, pbi.total_amount, pbi.base_unit_rate,
        i.sku AS item_sku, i.name AS item_name, i.item_type, i.base_uom_id AS item_base_uom,
        u.name AS uom_name
      FROM purchase_bill_items pbi
      JOIN items i ON pbi.item_id = i.id
      JOIN units_of_measure u ON pbi.uom_id = u.id
      WHERE pbi.purchase_bill_id = $1
      ORDER BY pbi.id ASC;
    `;
    const itemsRes = await query(itemsSql, [id]);
    bill.items = itemsRes.rows;

    return bill;
  },

  /**
   * Find bill by supplier ID and bill number (for uniqueness check)
   */
  async findBySupplierAndBillNumber(supplierId, billNumber) {
    const text = `
      SELECT id, supplier_id, bill_number, status
      FROM purchase_bills
      WHERE supplier_id = $1 AND bill_number = $2;
    `;
    const res = await query(text, [supplierId, billNumber]);
    return res.rows[0] || null;
  },

  /**
   * Create purchase bill with line items inside a single database transaction
   */
  async createWithItems(billHeader, items, client) {
    const dbClient = client || (await getClient());
    const isLocalTransaction = !client;

    try {
      if (isLocalTransaction) await dbClient.query('BEGIN');

      const billSql = `
        INSERT INTO purchase_bills (
          supplier_id, bill_number, bill_date,
          subtotal_amount, cgst_amount, sgst_amount, igst_amount, total_amount,
          status, received_by, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *;
      `;
      const billRes = await dbClient.query(billSql, [
        billHeader.supplier_id,
        billHeader.bill_number,
        billHeader.bill_date,
        billHeader.subtotal_amount,
        billHeader.cgst_amount,
        billHeader.sgst_amount,
        billHeader.igst_amount,
        billHeader.total_amount,
        billHeader.status || 'draft',
        billHeader.received_by,
        billHeader.notes || null,
      ]);
      const createdBill = billRes.rows[0];

      const itemSql = `
        INSERT INTO purchase_bill_items (
          purchase_bill_id, item_id, supplier_batch_no, expiry_date,
          quantity, uom_id, base_quantity, unit_rate, taxable_amount,
          gst_rate_pct, tax_amount, total_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *;
      `;

      createdBill.items = [];
      for (const item of items) {
        const itemRes = await dbClient.query(itemSql, [
          createdBill.id,
          item.item_id,
          item.supplier_batch_no || null,
          item.expiry_date || null,
          item.quantity,
          item.uom_id,
          item.base_quantity,
          item.unit_rate,
          item.taxable_amount,
          item.gst_rate_pct,
          item.tax_amount,
          item.total_amount,
        ]);
        createdBill.items.push(itemRes.rows[0]);
      }

      if (isLocalTransaction) await dbClient.query('COMMIT');
      return createdBill;
    } catch (err) {
      if (isLocalTransaction) await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      if (isLocalTransaction) dbClient.release();
    }
  },

  /**
   * Update purchase bill header and replace line items inside a transaction
   */
  async updateWithItems(billId, billHeader, items, client) {
    const dbClient = client || (await getClient());
    const isLocalTransaction = !client;

    try {
      if (isLocalTransaction) await dbClient.query('BEGIN');

      const headerFields = [];
      const values = [];
      let idx = 1;

      for (const [key, val] of Object.entries(billHeader)) {
        if (val !== undefined) {
          headerFields.push(`${key} = $${idx}`);
          values.push(val);
          idx++;
        }
      }

      if (headerFields.length > 0) {
        values.push(billId);
        await dbClient.query(
          `UPDATE purchase_bills SET ${headerFields.join(', ')} WHERE id = $${idx};`,
          values
        );
      }

      if (items && items.length > 0) {
        await dbClient.query(`DELETE FROM purchase_bill_items WHERE purchase_bill_id = $1;`, [billId]);

        const itemSql = `
          INSERT INTO purchase_bill_items (
            purchase_bill_id, item_id, supplier_batch_no, expiry_date,
            quantity, uom_id, base_quantity, unit_rate, taxable_amount,
            gst_rate_pct, tax_amount, total_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
        `;

        for (const item of items) {
          await dbClient.query(itemSql, [
            billId,
            item.item_id,
            item.supplier_batch_no || null,
            item.expiry_date || null,
            item.quantity,
            item.uom_id,
            item.base_quantity,
            item.unit_rate,
            item.taxable_amount,
            item.gst_rate_pct,
            item.tax_amount,
            item.total_amount,
          ]);
        }
      }

      if (isLocalTransaction) await dbClient.query('COMMIT');
      return true;
    } catch (err) {
      if (isLocalTransaction) await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      if (isLocalTransaction) dbClient.release();
    }
  },

  /**
   * Update purchase bill status
   */
  async updateStatus(billId, status) {
    const res = await query(
      `UPDATE purchase_bills SET status = $1 WHERE id = $2 RETURNING id, bill_number, status;`,
      [status, billId]
    );
    return res.rows[0] || null;
  },

  /**
   * Post purchase receipt to inventory using the database atomic function
   */
  async postPurchaseReceipt(billId, userId) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT fn_post_purchase_receipt($1, $2);`, [billId, userId]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
