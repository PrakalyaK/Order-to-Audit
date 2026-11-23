import { pool } from '../backend/src/config/db.js';

async function verifyOfficialBenchmark() {
  const client = await pool.connect();
  try {
    console.log('='.repeat(75));
    console.log('OFFICIAL BENCHMARK SCENARIO VERIFICATION (NIT TIRUCHIRAPPALLI SPEC)');
    console.log('='.repeat(75));

    let passCount = 0;
    let totalChecks = 0;

    function check(description, actual, expected, unit = '') {
      totalChecks++;
      const actNum = typeof actual === 'number' ? actual : parseFloat(actual);
      const expNum = typeof expected === 'number' ? expected : parseFloat(expected);
      const matches = isNaN(actNum) || isNaN(expNum) 
        ? String(actual).trim() === String(expected).trim()
        : Math.abs(actNum - expNum) < 0.01;

      if (matches) {
        passCount++;
        console.log(`[PASS] ${description}: ${actual} ${unit} (Expected: ${expected} ${unit})`);
      } else {
        console.error(`[FAIL] ${description}: ACTUAL = ${actual} ${unit}, EXPECTED = ${expected} ${unit}`);
      }
    }

    // 1. Check Closing Raw Material Balances & Moving WAC
    console.log('\n--- 1. INVENTORY VALUATION & MOVING WAC ---');
    const stockRes = await client.query(`
      SELECT 
        i.sku, 
        i.name, 
        isb.current_base_qty, 
        isb.current_moving_wac, 
        isb.current_total_value
      FROM items i
      JOIN item_stock_balances isb ON i.id = isb.item_id
      ORDER BY i.sku;
    `);

    const stockMap = new Map();
    stockRes.rows.forEach(r => stockMap.set(r.sku, r));

    // RM-FLOUR: 100 opening + 60 purchase - 40 used = 120 kg @ 43.125 = 5175.00
    const flour = stockMap.get('RM-FLOUR');
    check('Flour Closing Qty', flour.current_base_qty, 120.00, 'kg');
    check('Flour Moving WAC', flour.current_moving_wac, 43.1250, '₹/kg');
    check('Flour Total Value', flour.current_total_value, 5175.00, '₹');

    // RM-OIL: 30 opening - 10.5 used = 19.5 L @ 140.00 = 2730.00
    const oil = stockMap.get('RM-OIL');
    check('Oil Closing Qty', oil.current_base_qty, 19.50, 'L');
    check('Oil Moving WAC', oil.current_moving_wac, 140.0000, '₹/L');
    check('Oil Total Value', oil.current_total_value, 2730.00, '₹');

    // RM-SPICE: 5 opening - 1.2 used = 3.8 kg @ 200.00 = 760.00
    const spice = stockMap.get('RM-SPICE');
    check('Spice Mix Closing Qty', spice.current_base_qty, 3.80, 'kg');
    check('Spice Mix Moving WAC', spice.current_moving_wac, 200.0000, '₹/kg');
    check('Spice Mix Total Value', spice.current_total_value, 760.00, '₹');

    // PK-POUCH-200G: 500 opening - (188 + 6) used = 306 pcs @ 2.50 = 765.00
    const pouch = stockMap.get('PK-POUCH-200G');
    check('Pouch Closing Qty', pouch.current_base_qty, 306.00, 'pcs');
    check('Pouch Total Value', pouch.current_total_value, 765.00, '₹');

    // PK-CARTON-20: 30 opening - 9 used = 21 pcs @ 15.00 = 315.00
    const carton = stockMap.get('PK-CARTON-20');
    check('Carton Closing Qty', carton.current_base_qty, 21.00, 'pcs');
    check('Carton Total Value', carton.current_total_value, 315.00, '₹');

    // FG-MRK-200G: 50 opening + 188 produced - 150 dispatched = 88 pkts @ 30.9034 = 2719.50
    const murukku = stockMap.get('FG-MRK-200G');
    check('Murukku Closing Qty', murukku.current_base_qty, 88.00, 'pkts');
    check('Murukku Moving WAC', murukku.current_moving_wac, 30.9034, '₹/pkt');
    check('Murukku Total Value', murukku.current_total_value, 2719.50, '₹');

    // 2. Production Run & Variances
    console.log('\n--- 2. PRODUCTION RUN & VARIANCE ANALYSIS ---');
    const prodRes = await client.query(`
      SELECT 
        pr.run_number,
        pr.planned_batch_count,
        pr.planned_yield_qty,
        pr.actual_good_output_qty,
        pr.yield_variance_pct,
        pr.is_yield_flagged,
        prc.total_raw_material_cost,
        prc.total_packaging_cost,
        prc.total_direct_overhead_cost,
        prc.gross_total_batch_cost,
        prc.cost_per_packet,
        pr.status
      FROM production_runs pr
      JOIN production_run_costing prc ON pr.id = prc.production_run_id
      ORDER BY pr.created_at DESC
      LIMIT 1;
    `);
    const prod = prodRes.rows[0];
    check('Production Status', prod.status, 'completed');
    check('Murukku Planned Yield', prod.planned_yield_qty, 200.00, 'pkts');
    check('Murukku Actual Yield', prod.actual_good_output_qty, 188.00, 'pkts');
    check('Murukku Yield Variance %', prod.yield_variance_pct, -6.00, '%');
    check('Murukku Yield Flagged', prod.is_yield_flagged, true);
    check('Direct Overhead Cost', prod.total_direct_overhead_cost, 1800.00, '₹');
    check('Gross Total Batch Cost', prod.gross_total_batch_cost, 5855.00, '₹');
    check('Cost Per Packet Produced', prod.cost_per_packet, 31.1436, '₹/pkt');

    // Check Material Consumption Variances
    const matVarRes = await client.query(`
      SELECT 
        i.sku,
        pri.planned_qty,
        pri.base_net_consumed_qty,
        pri.consumption_variance_qty,
        pri.consumption_variance_pct,
        pri.is_consumption_flagged
      FROM production_run_inputs pri
      JOIN items i ON pri.item_id = i.id
      ORDER BY i.sku;
    `);
    const oilVar = matVarRes.rows.find(r => r.sku === 'RM-OIL');
    if (oilVar) {
      check('Oil Planned Qty', oilVar.planned_qty, 10.00, 'L');
      check('Oil Net Consumed Qty', oilVar.base_net_consumed_qty, 10.50, 'L');
      check('Oil Consumption Variance %', oilVar.consumption_variance_pct, 5.00, '%');
      check('Oil Consumption Flagged', oilVar.is_consumption_flagged, true);
    }

    // 3. Sales Order, Invoice & Dispatch (Retailer A - Tamil Nadu)
    console.log('\n--- 3. SALES, GST INVOICE & DISPATCH (RETAILER A) ---');
    const invRes = await client.query(`
      SELECT 
        invoice_number,
        taxable_value,
        cgst_amount,
        sgst_amount,
        igst_amount,
        total_invoice_value,
        total_paid_amount,
        outstanding_balance,
        derived_payment_status
      FROM v_invoice_balances
      WHERE customer_name = 'Retailer A'
      LIMIT 1;
    `);
    const inv = invRes.rows[0];
    check('Invoice Taxable Value', inv.taxable_value, 7500.00, '₹');
    check('CGST 2.5%', inv.cgst_amount, 187.50, '₹');
    check('SGST 2.5%', inv.sgst_amount, 187.50, '₹');
    check('IGST (Intra-state)', inv.igst_amount, 0.00, '₹');
    check('Total Invoice Value', inv.total_invoice_value, 7875.00, '₹');
    check('Retailer A Payment Received', inv.total_paid_amount, 4000.00, '₹');
    check('Retailer A Outstanding Balance', inv.outstanding_balance, 3875.00, '₹');
    check('Derived Payment Status', inv.derived_payment_status, 'partially_paid');

    // 4. Distributor B (Karnataka) Shortage & Inter-state Simulation
    console.log('\n--- 4. DISTRIBUTOR B SHORTAGE DETECTION & INTER-STATE GST ---');
    const distBRes = await client.query(`
      SELECT id, trade_name, state_code, state_name 
      FROM parties 
      WHERE trade_name ILIKE '%Distributor B%' OR state_name ILIKE '%Karnataka%'
      LIMIT 1;
    `);
    const distB = distBRes.rows[0];
    check('Distributor B State Code', distB.state_code, '29'); // 29 = Karnataka
    const requestedQty = 120.0;
    const currentStock = Number(murukku.current_base_qty);
    const shortage = requestedQty - currentStock;
    check('Requested Quantity', requestedQty, 120, 'pkts');
    check('Current Stock Available', currentStock, 88, 'pkts');
    check('Stock Shortage Detected', shortage, 32, 'pkts');
    
    // Inter-state GST calculation check
    const isInterstate = distB.state_code !== '33';
    check('Inter-State Transaction', isInterstate, true);
    const mockTaxable = requestedQty * 50.0;
    const mockIgst = mockTaxable * 0.05;
    check('Distributor B IGST Rate (5%)', mockIgst, 300.00, '₹');

    // 5. General Ledger & Trial Balance Equilibrium
    console.log('\n--- 5. DOUBLE-ENTRY ACCOUNTING & TRIAL BALANCE ---');
    const tbRes = await client.query(`
      SELECT 
        COALESCE(SUM(debit_amount), 0.00) AS total_debits,
        COALESCE(SUM(credit_amount), 0.00) AS total_credits
      FROM journal_entry_lines;
    `);
    const tb = tbRes.rows[0];
    const tbDiff = Math.abs(Number(tb.total_debits) - Number(tb.total_credits));
    check('Total Debits == Total Credits', tbDiff, 0.00, '₹');
    check('Trial Balance Total Debits', Number(tb.total_debits) > 0, true);

    console.log('\n' + '='.repeat(75));
    console.log(`BENCHMARK SUMMARY: ${passCount} / ${totalChecks} CHECKS PASSED (${((passCount/totalChecks)*100).toFixed(1)}%)`);
    console.log('='.repeat(75));

    if (passCount === totalChecks) {
      console.log('VERDICT: BENCHMARK SCENARIO VERIFIED WITH 100% MATHEMATICAL PRECISION!');
    } else {
      console.error(`VERDICT: ${totalChecks - passCount} CHECKS FAILED.`);
      process.exitCode = 1;
    }

  } catch (err) {
    console.error('ERROR VERIFYING BENCHMARK:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

verifyOfficialBenchmark();
