import { query } from '../../config/db.js';

class BatchesRepository {
  async findBatches(filters = {}) {
    const conditions = [];
    const values = [];

    if (filters.item_id) {
      values.push(filters.item_id);
      conditions.push(`item_id = $${values.length}`);
    }
    if (filters.warehouse_id) {
      values.push(filters.warehouse_id);
      conditions.push(`warehouse_id = $${values.length}`);
    }
    if (filters.is_expired !== undefined) {
      values.push(filters.is_expired);
      conditions.push(`is_expired = $${values.length}`);
    }
    if (filters.is_near_expiry !== undefined) {
      values.push(filters.is_near_expiry);
      conditions.push(`is_near_expiry = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM v_batch_stock
      ${whereClause}
      ORDER BY expiry_date ASC NULLS LAST, batch_number ASC
    `;
    const res = await query(sql, values);
    return res.rows;
  }

  async findNearExpiryBatches(warehouseId = null) {
    const conditions = ['is_near_expiry = true'];
    const values = [];
    if (warehouseId) {
      values.push(warehouseId);
      conditions.push(`warehouse_id = $${values.length}`);
    }
    const sql = `
      SELECT * FROM v_batch_stock 
      WHERE ${conditions.join(' AND ')} 
      ORDER BY days_to_expiry ASC
    `;
    const res = await query(sql, values);
    return res.rows;
  }

  async findExpiredBatches(warehouseId = null) {
    const conditions = ['is_expired = true'];
    const values = [];
    if (warehouseId) {
      values.push(warehouseId);
      conditions.push(`warehouse_id = $${values.length}`);
    }
    const sql = `
      SELECT * FROM v_batch_stock 
      WHERE ${conditions.join(' AND ')} 
      ORDER BY expiry_date DESC
    `;
    const res = await query(sql, values);
    return res.rows;
  }

  async findBatchesForFefo(itemId, warehouseId = null) {
    const conditions = [
      'item_id = $1',
      'available_qty > 0',
      'is_expired = false',
    ];
    const values = [itemId];

    if (warehouseId) {
      values.push(warehouseId);
      conditions.push(`warehouse_id = $${values.length}`);
    }

    const sql = `
      SELECT * FROM v_batch_stock
      WHERE ${conditions.join(' AND ')}
      ORDER BY expiry_date ASC NULLS LAST, batch_number ASC
    `;
    const res = await query(sql, values);
    return res.rows;
  }

  async getTraceabilityByBatch(batchNumber) {
    // 1. Check if it's an output batch from a production run
    const prRes = await query(
      `SELECT pr.*, i.sku, i.name AS fg_item_name, u.username AS supervisor_username
       FROM production_runs pr
       JOIN items i ON pr.finished_good_item_id = i.id
       JOIN users u ON pr.supervisor_id = u.id
       WHERE pr.output_batch_number = $1`,
      [batchNumber]
    );

    let productionRun = prRes.rows[0] || null;
    let rawMaterialInputs = [];
    let inwardPurchaseBills = [];

    if (productionRun) {
      // Find inputs consumed in this production run
      const inputRes = await query(
        `SELECT pri.*, i.sku, i.name AS item_name, i.item_type
         FROM production_run_inputs pri
         JOIN items i ON pri.item_id = i.id
         WHERE pri.production_run_id = $1`,
        [productionRun.id]
      );
      rawMaterialInputs = inputRes.rows;

      // Find inward purchase bills for these consumed raw materials
      const billRes = await query(
        `SELECT DISTINCT pb.id, pb.bill_number, pb.bill_date, p.trade_name AS supplier_name, pbi.supplier_batch_no, pbi.item_id, i.name AS item_name
         FROM purchase_bills pb
         JOIN purchase_bill_items pbi ON pb.id = pbi.purchase_bill_id
         JOIN parties p ON pb.supplier_id = p.id
         JOIN items i ON pbi.item_id = i.id
         WHERE pbi.item_id IN (SELECT item_id FROM production_run_inputs WHERE production_run_id = $1)`,
        [productionRun.id]
      );
      inwardPurchaseBills = billRes.rows;
    } else {
      // Check if it's a raw material supplier batch received directly in a purchase bill
      const directBillRes = await query(
        `SELECT pb.id, pb.bill_number, pb.bill_date, p.trade_name AS supplier_name, pbi.supplier_batch_no, pbi.item_id, i.name AS item_name
         FROM purchase_bills pb
         JOIN purchase_bill_items pbi ON pb.id = pbi.purchase_bill_id
         JOIN parties p ON pb.supplier_id = p.id
         JOIN items i ON pbi.item_id = i.id
         WHERE pbi.supplier_batch_no = $1`,
        [batchNumber]
      );
      inwardPurchaseBills = directBillRes.rows;
    }

    // 2. Find customer dispatches where this batch was dispatched
    const dispRes = await query(
      `SELECT d.id AS dispatch_id, d.dispatch_number, d.dispatch_date, d.carrier_or_vehicle_no, d.driver_name,
              di.dispatched_qty, di.uom_id,
              inv.id AS invoice_id, inv.invoice_number, inv.invoice_date,
              p.trade_name AS customer_name
       FROM dispatch_items di
       JOIN dispatches d ON di.dispatch_id = d.id
       JOIN invoices inv ON d.invoice_id = inv.id
       JOIN parties p ON inv.customer_id = p.id
       WHERE di.batch_number = $1`,
      [batchNumber]
    );

    return {
      batch_number: batchNumber,
      is_manufactured_batch: !!productionRun,
      production_run: productionRun,
      raw_material_inputs: rawMaterialInputs,
      raw_material_batches: rawMaterialInputs,
      supplier_inward_bills: inwardPurchaseBills,
      customer_dispatches: dispRes.rows,
      dispatches: dispRes.rows,
    };
  }
}

export const batchesRepository = new BatchesRepository();
