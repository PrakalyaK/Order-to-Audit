import { query } from '../../config/db.js';

export const reportsRepository = {
  /**
   * Get consolidated high-level KPIs for dashboard
   */
  async getDashboardKpis() {
    // 1. Sales summary
    const salesRes = await query(`
      SELECT 
        COALESCE(SUM(inv.total_invoice_value), 0) AS total_sales,
        COALESCE(SUM(pa.total_allocated), 0) AS total_collected,
        COUNT(inv.id) AS total_invoices
      FROM invoices inv
      LEFT JOIN (
        SELECT invoice_id, SUM(allocated_amount) AS total_allocated
        FROM payment_allocations
        WHERE status = 'active'
        GROUP BY invoice_id
      ) pa ON inv.id = pa.invoice_id
      WHERE inv.status <> 'cancelled';
    `);

    // 2. Purchases summary
    const purchaseRes = await query(`
      SELECT 
        COALESCE(SUM(pb.total_amount), 0) AS total_purchases,
        COALESCE(SUM(spa.total_allocated), 0) AS total_paid,
        COUNT(pb.id) AS total_bills
      FROM purchase_bills pb
      LEFT JOIN (
        SELECT purchase_bill_id, SUM(allocated_amount) AS total_allocated
        FROM supplier_payment_allocations
        WHERE status = 'active'
        GROUP BY purchase_bill_id
      ) spa ON pb.id = spa.purchase_bill_id
      WHERE pb.status <> 'cancelled';
    `);

    // 3. Inventory valuation & alerts
    const invValRes = await query(`
      SELECT 
        COALESCE(SUM(current_total_value), 0) AS total_valuation,
        COUNT(DISTINCT item_id) AS distinct_items_count
      FROM item_stock_balances;
    `);

    const lowStockRes = await query(`
      SELECT COUNT(*) AS low_stock_count
      FROM items i
      LEFT JOIN item_stock_balances isb ON i.id = isb.item_id
      WHERE COALESCE(isb.current_base_qty, 0) <= i.min_reorder_level
        AND i.is_active = true;
    `);

    const nearExpiryRes = await query(`
      SELECT COUNT(*) AS near_expiry_count
      FROM v_batch_stock
      WHERE is_near_expiry = true
        AND available_qty > 0;
    `);

    // 4. Production summary
    const prodRes = await query(`
      SELECT 
        COUNT(*) FILTER (WHERE status IN ('draft', 'materials_issued')) AS active_runs_count,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_runs_count
      FROM production_runs;
    `);

    // 5. Receivables & Payables
    const recRes = await query(`
      SELECT COALESCE(SUM(net_invoice_receivables), 0) AS total_receivables
      FROM v_customer_outstanding;
    `);

    const payRes = await query(`
      SELECT COALESCE(SUM(net_payable_balance), 0) AS total_payables
      FROM v_supplier_outstanding;
    `);

    // 6. Recent Operational Records
    const recentInvoices = await query(`
      SELECT inv.id, inv.invoice_number, inv.invoice_date, inv.total_invoice_value AS total_amount, inv.status, p.trade_name AS customer_name
      FROM invoices inv
      JOIN parties p ON inv.customer_id = p.id
      ORDER BY inv.created_at DESC
      LIMIT 5;
    `);

    const recentRuns = await query(`
      SELECT pr.id, pr.run_number, pr.status, pr.run_date, i.name AS item_name, pr.planned_yield_qty AS planned_output_qty, pr.actual_good_output_qty AS actual_output_qty
      FROM production_runs pr
      JOIN items i ON pr.finished_good_item_id = i.id
      ORDER BY pr.created_at DESC
      LIMIT 5;
    `);

    const recentBills = await query(`
      SELECT pb.id, pb.bill_number, pb.bill_date, pb.total_amount, pb.status, p.trade_name AS supplier_name
      FROM purchase_bills pb
      JOIN parties p ON pb.supplier_id = p.id
      ORDER BY pb.created_at DESC
      LIMIT 5;
    `);

    return {
      sales: {
        total_sales: parseFloat(salesRes.rows[0].total_sales),
        total_collected: parseFloat(salesRes.rows[0].total_collected),
        total_invoices: parseInt(salesRes.rows[0].total_invoices, 10),
      },
      purchases: {
        total_purchases: parseFloat(purchaseRes.rows[0].total_purchases),
        total_paid: parseFloat(purchaseRes.rows[0].total_paid),
        total_bills: parseInt(purchaseRes.rows[0].total_bills, 10),
      },
      inventory: {
        total_valuation: parseFloat(invValRes.rows[0].total_valuation),
        distinct_items_count: parseInt(invValRes.rows[0].distinct_items_count, 10),
        low_stock_count: parseInt(lowStockRes.rows[0].low_stock_count, 10),
        near_expiry_count: parseInt(nearExpiryRes.rows[0].near_expiry_count, 10),
      },
      production: {
        active_runs_count: parseInt(prodRes.rows[0].active_runs_count || 0, 10),
        completed_runs_count: parseInt(prodRes.rows[0].completed_runs_count || 0, 10),
      },
      receivables: {
        total_outstanding: parseFloat(recRes.rows[0].total_receivables),
      },
      payables: {
        total_outstanding: parseFloat(payRes.rows[0].total_payables),
      },
      recent: {
        invoices: recentInvoices.rows,
        production_runs: recentRuns.rows,
        purchase_bills: recentBills.rows,
      },
    };
  },

  async getSalesAnalytics() {
    const outwardGst = await query('SELECT * FROM v_gst_outward_summary ORDER BY tax_period DESC LIMIT 50;');
    const customerOutstanding = await query('SELECT * FROM v_customer_outstanding ORDER BY net_invoice_receivables DESC;');
    const topItems = await query(`
      SELECT 
        i.name, i.sku,
        SUM(ii.quantity) AS total_quantity_sold,
        SUM(ii.total_item_value) AS total_revenue
      FROM invoice_items ii
      JOIN items i ON ii.item_id = i.id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE inv.status <> 'cancelled'
      GROUP BY i.id, i.name, i.sku
      ORDER BY total_revenue DESC
      LIMIT 10;
    `);

    return {
      gst_outward: outwardGst.rows,
      customer_outstanding: customerOutstanding.rows,
      top_selling_items: topItems.rows,
    };
  },

  async getInventoryAnalytics() {
    const warehouseStock = await query('SELECT * FROM v_warehouse_stock ORDER BY item_name, warehouse_name;');
    const batchStock = await query('SELECT * FROM v_batch_stock WHERE available_qty > 0 ORDER BY expiry_date ASC NULLS LAST;');
    const stockValuationByCategory = await query(`
      SELECT 
        i.item_type,
        COUNT(i.id) AS items_count,
        COALESCE(SUM(isb.current_base_qty), 0) AS total_units,
        COALESCE(SUM(isb.current_total_value), 0) AS total_valuation
      FROM items i
      LEFT JOIN item_stock_balances isb ON i.id = isb.item_id
      GROUP BY i.item_type;
    `);

    return {
      warehouse_stock: warehouseStock.rows,
      batch_stock: batchStock.rows,
      valuation_by_category: stockValuationByCategory.rows,
    };
  },

  async getProductionAnalytics() {
    const varianceData = await query('SELECT * FROM v_production_variance LIMIT 100;');
    const runsSummary = await query(`
      SELECT 
        pr.id, pr.run_number, pr.run_date, pr.status,
        i.name AS item_name, i.sku,
        pr.planned_yield_qty AS planned_output_qty, pr.actual_good_output_qty AS actual_output_qty,
        COALESCE(prc.gross_total_batch_cost, 0) AS total_cost,
        COALESCE(prc.cost_per_packet, 0) AS cost_per_unit
      FROM production_runs pr
      JOIN items i ON pr.finished_good_item_id = i.id
      LEFT JOIN production_run_costing prc ON pr.id = prc.production_run_id
      ORDER BY pr.created_at DESC
      LIMIT 50;
    `);

    return {
      runs: runsSummary.rows,
      variance: varianceData.rows,
    };
  },

  async getFinancialAnalytics() {
    const pl = await query('SELECT * FROM v_profit_and_loss;');
    const tb = await query('SELECT * FROM v_trial_balance;');
    const cashBank = await query('SELECT * FROM v_cash_bank_summary;');
    return {
      profit_and_loss: pl.rows,
      trial_balance: tb.rows,
      cash_bank: cashBank.rows,
    };
  },

  async getBatchTraceability(batchNumber) {
    // 1. Check if this batch is produced in a production run
    const prodRes = await query(`
      SELECT 
        pr.id AS production_run_id,
        pr.run_number,
        pr.run_date,
        pr.status,
        pr.actual_good_output_qty AS actual_output_qty,
        i.name AS finished_good_name,
        i.sku AS finished_good_sku
      FROM production_runs pr
      JOIN items i ON pr.finished_good_item_id = i.id
      WHERE pr.output_batch_number = $1;
    `, [batchNumber]);

    let productionRun = null;
    let inputs = [];
    if (prodRes.rows.length > 0) {
      productionRun = prodRes.rows[0];
      const inputsRes = await query(`
        SELECT 
          pri.id,
          i.name AS material_name,
          i.sku AS material_sku,
          pri.actual_issued_qty AS quantity_used,
          u.id AS uom
        FROM production_run_inputs pri
        JOIN items i ON pri.item_id = i.id
        LEFT JOIN units_of_measure u ON pri.uom_id = u.id
        WHERE pri.production_run_id = $1;
      `, [productionRun.production_run_id]);
      inputs = inputsRes.rows;
    }

    // 2. Check if this batch was received from a purchase bill
    const purchaseRes = await query(`
      SELECT 
        pb.id, pb.bill_number, pb.bill_date, p.trade_name AS supplier_name,
        pbi.quantity, pbi.unit_rate AS rate, i.name AS item_name, i.sku
      FROM purchase_bill_items pbi
      JOIN purchase_bills pb ON pbi.purchase_bill_id = pb.id
      JOIN parties p ON pb.supplier_id = p.id
      JOIN items i ON pbi.item_id = i.id
      WHERE pbi.supplier_batch_no = $1;
    `, [batchNumber]);

    // 3. Check customer dispatches & invoices for this batch
    const dispatchRes = await query(`
      SELECT 
        d.id AS dispatch_id, d.dispatch_number, d.dispatch_date, d.status,
        di.dispatched_qty AS quantity_dispatched,
        inv.invoice_number, inv.invoice_date,
        c.trade_name AS customer_name, c.state_name
      FROM dispatch_items di
      JOIN dispatches d ON di.dispatch_id = d.id
      JOIN invoices inv ON d.invoice_id = inv.id
      JOIN parties c ON inv.customer_id = c.id
      WHERE di.batch_number = $1;
    `, [batchNumber]);

    // 4. Check inventory ledger movements for this batch
    const ledgerRes = await query(`
      SELECT 
        il.id, il.movement_type, il.base_quantity_delta AS quantity, il.unit_cost,
        il.source_reference_label,
        il.transaction_timestamp AS transaction_date, w.name AS warehouse_name
      FROM inventory_ledger il
      LEFT JOIN warehouses w ON il.warehouse_id = w.id
      WHERE il.batch_number = $1
      ORDER BY il.transaction_timestamp ASC;
    `, [batchNumber]);

    return {
      batch_number: batchNumber,
      as_finished_good: {
        production_run: productionRun,
        raw_materials_used: inputs,
        customer_dispatches: dispatchRes.rows,
      },
      as_purchased_material: purchaseRes.rows,
      ledger_history: ledgerRes.rows,
    };
  },
};
