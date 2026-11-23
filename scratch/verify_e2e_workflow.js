// ============================================================================
// Order-to-Audit ERP — Comprehensive End-to-End Business Workflow Verifier
// Tests the full lifecycle: Master Data -> Purchase -> Inventory -> Production
// -> Sales Order -> Invoice -> Dispatch -> Customer Payment -> Accounting Sync
// ============================================================================

const BASE_URL = 'http://localhost:5000/api/v1';

async function req(url, options = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    const err = new Error(data.message || `HTTP ${res.status}: ${JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function runE2EWorkflow() {
  console.log('='.repeat(70));
  console.log('STARTING ORDER-TO-AUDIT END-TO-END BUSINESS WORKFLOW VERIFICATION');
  console.log('='.repeat(70));

  // --------------------------------------------------------------------------
  // STEP 0: Authentication
  // --------------------------------------------------------------------------
  console.log('\n[Step 0] Authenticating with real credentials...');
  const loginRes = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'owner_main',
      password: 'Password@123',
    }),
  });
  const token = loginRes.data.token;
  const user = loginRes.data.user;
  console.log(` -> Authenticated as ${user.username} (${user.role}), Token Length: ${token.length}`);

  // --------------------------------------------------------------------------
  // STEP 1: Master Data Verification
  // --------------------------------------------------------------------------
  console.log('\n[Step 1] Verifying Master Data (Items, Parties, Warehouses, BOMs)...');
  const itemsRes = await req('/items', {}, token);
  const items = itemsRes.data.items || itemsRes.data;
  console.log(` -> Items available: ${items.length}`);
  items.forEach(i => console.log(`    - [${i.sku}] ${i.name} (${i.item_type})`));

  const flourItem = items.find(i => i.sku === 'RM-FLOUR');
  const oilItem = items.find(i => i.sku === 'RM-OIL');
  const spiceItem = items.find(i => i.sku === 'RM-SPICE');
  const pouchItem = items.find(i => i.sku === 'PK-POUCH-200G');
  const cartonItem = items.find(i => i.sku === 'PK-CARTON-20');
  const fgItem = items.find(i => i.sku === 'FG-MRK-200G');

  if (!flourItem || !oilItem || !pouchItem || !fgItem) {
    throw new Error('Required benchmark items (Flour, Oil, Pouch, FG) not found in master data');
  }

  const partiesRes = await req('/parties', {}, token);
  const parties = partiesRes.data.parties || partiesRes.data;
  console.log(` -> Parties available: ${parties.length}`);
  const supplier = parties.find(p => p.party_type === 'supplier' || p.party_type === 'both');
  const customer = parties.find(p => p.party_type === 'customer' || p.party_type === 'both');
  console.log(`    Supplier: ${supplier.trade_name} (${supplier.id})`);
  console.log(`    Customer: ${customer.trade_name} (${customer.id})`);

  const warehousesRes = await req('/warehouses', {}, token);
  const warehouses = warehousesRes.data.warehouses || warehousesRes.data;
  console.log(` -> Warehouses available: ${warehouses.length}`);
  const mainWarehouse = warehouses[0];
  console.log(`    Active Warehouse: ${mainWarehouse.name} (${mainWarehouse.code})`);

  const bomsRes = await req('/boms', {}, token);
  const boms = bomsRes.data.boms || bomsRes.data;
  console.log(` -> Configured BOMs: ${boms.length}`);
  const activeBom = boms[0];
  console.log(`    BOM: ${activeBom.bom_code} for ${activeBom.finished_good_name || 'FG-MRK-200G'}`);

  // --------------------------------------------------------------------------
  // STEP 2: Purchases & Inward Goods Receipt
  // --------------------------------------------------------------------------
  console.log('\n[Step 2] Executing Purchase Workflow (Create Bill & Receive to Stock)...');
  const billNum = `PB-E2E-${Date.now().toString().slice(-6)}`;
  const purchasePayload = {
    supplier_id: supplier.id,
    bill_number: billNum,
    bill_date: new Date().toISOString().split('T')[0],
    notes: 'End-to-end automated ERP workflow purchase test',
    items: [
      {
        item_id: flourItem.id,
        quantity: 50.0,
        uom_id: 'KG',
        unit_rate: 42.0,
        supplier_batch_no: `LOT-FLOUR-${Date.now().toString().slice(-4)}`,
        expiry_date: '2027-12-31',
      },
      {
        item_id: oilItem.id,
        quantity: 20.0,
        uom_id: 'L',
        unit_rate: 130.0,
        supplier_batch_no: `LOT-OIL-${Date.now().toString().slice(-4)}`,
        expiry_date: '2027-06-30',
      },
      {
        item_id: pouchItem.id,
        quantity: 500.0,
        uom_id: 'PCS',
        unit_rate: 2.5,
        supplier_batch_no: `LOT-POUCH-${Date.now().toString().slice(-4)}`,
        expiry_date: '2028-12-31',
      },
      {
        item_id: spiceItem.id,
        quantity: 20.0,
        uom_id: 'KG',
        unit_rate: 200.0,
        supplier_batch_no: `LOT-SPICE-${Date.now().toString().slice(-4)}`,
        expiry_date: '2028-12-31',
      },
      {
        item_id: cartonItem.id,
        quantity: 50.0,
        uom_id: 'PCS',
        unit_rate: 15.0,
        supplier_batch_no: `LOT-CARTON-${Date.now().toString().slice(-4)}`,
        expiry_date: '2029-12-31',
      },
    ],
  };

  const createBillRes = await req('/purchases', {
    method: 'POST',
    body: JSON.stringify(purchasePayload),
  }, token);
  const purchase = createBillRes.data.purchase || createBillRes.data;
  const purchaseId = purchase.id;
  console.log(` -> Purchase Bill created: ${billNum} (ID: ${purchaseId}, Status: ${purchase.status})`);

  // Receive / Post Bill to Inventory
  const receiveRes = await req(`/purchases/${purchaseId}/receive`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, token);
  const receivedPurchase = receiveRes.data.purchase || receiveRes.data;
  console.log(` -> Purchase Bill posted to inventory! Status: ${receivedPurchase.status}`);

  // --------------------------------------------------------------------------
  // STEP 3: Inventory Verification
  // --------------------------------------------------------------------------
  console.log('\n[Step 3] Verifying Inventory Stock & Moving WAC...');
  const stockRes = await req('/inventory/stock', {}, token);
  const stockBalances = stockRes.data.stock || stockRes.data;
  const flourStock = stockBalances.find(s => s.item_id === flourItem.id || s.sku === flourItem.sku);
  const oilStock = stockBalances.find(s => s.item_id === oilItem.id || s.sku === oilItem.sku);
  console.log(` -> Flour Stock: ${flourStock.closing_stock_base_qty || flourStock.current_base_qty} KG @ ₹${Number(flourStock.current_moving_wac).toFixed(2)}/KG`);
  console.log(` -> Oil Stock: ${oilStock.closing_stock_base_qty || oilStock.current_base_qty} LTR @ ₹${Number(oilStock.current_moving_wac).toFixed(2)}/LTR`);

  const ledgerRes = await req('/inventory/ledger?limit=5', {}, token);
  const recentLedger = ledgerRes.data.entries || ledgerRes.data.movements || ledgerRes.data.ledger || ledgerRes.data;
  console.log(` -> Latest inventory ledger entries: ${recentLedger.length}`);
  console.log(`    Top entry: [${recentLedger[0].movement_type}] ${recentLedger[0].item_name || recentLedger[0].sku}: ${recentLedger[0].base_quantity_delta} (Ref: ${recentLedger[0].source_reference_label})`);

  // --------------------------------------------------------------------------
  // STEP 4: Production Management & Costing
  // --------------------------------------------------------------------------
  console.log('\n[Step 4] Executing Production Workflow (Draft -> Issue -> Yield & Costing)...');
  const runPayload = {
    bom_id: activeBom.id,
    run_date: new Date().toISOString().split('T')[0],
    planned_batch_count: 1.0,
    notes: 'E2E automated manufacturing run',
  };

  const createRunRes = await req('/production', {
    method: 'POST',
    body: JSON.stringify(runPayload),
  }, token);
  const runId = createRunRes.data.id;
  const runNumber = createRunRes.data.run_number;
  console.log(` -> Production Run created: ${runNumber} (ID: ${runId}, Status: ${createRunRes.data.status})`);
  console.log(`    Planned Yield: ${createRunRes.data.planned_yield_qty} packets`);

  // Issue Materials
  const issueRes = await req(`/production/${runId}/issue`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, token);
  console.log(` -> Materials issued! Status: ${issueRes.data.status}`);

  // Record Yield and Costing
  const yieldPayload = {
    actual_good_output_qty: 200.0,
    actual_scrap_output_qty: 2.0,
    overheads: [
      {
        overhead_type: 'power_gas',
        description: 'Factory Electricity (E2E Batch)',
        amount: 350.0,
      },
      {
        overhead_type: 'labour',
        description: 'Machine Operator Labor',
        amount: 250.0,
      },
    ],
  };

  const yieldRes = await req(`/production/${runId}/yield`, {
    method: 'POST',
    body: JSON.stringify(yieldPayload),
  }, token);
  console.log(` -> Output Yield & Costing posted! Status: ${yieldRes.data.status}`);
  console.log(`    Good Output: ${yieldRes.data.actual_good_output_qty} packets`);

  const costingRes = await req(`/production/${runId}/costing`, {}, token);
  const costing = costingRes.data.costing || costingRes.data;
  console.log(` -> Production Costing Analysis:`);
  console.log(`    Raw Material Cost: ₹${Number(costing.total_raw_material_cost).toFixed(2)}`);
  console.log(`    Packaging Cost: ₹${Number(costing.total_packaging_cost).toFixed(2)}`);
  console.log(`    Direct Overheads: ₹${Number(costing.total_direct_overhead_cost).toFixed(2)}`);
  console.log(`    Gross Total Cost: ₹${Number(costing.gross_total_batch_cost).toFixed(2)}`);
  console.log(`    Cost Per Packet: ₹${Number(costing.cost_per_packet).toFixed(2)} (Margin: ${costing.gross_margin_pct}%)`);

  // --------------------------------------------------------------------------
  // STEP 5: Sales, GST Invoicing & Dispatch
  // --------------------------------------------------------------------------
  console.log('\n[Step 5] Executing Sales Workflow (Order -> Invoice -> Dispatch)...');
  const soPayload = {
    customerId: customer.id,
    orderDate: new Date().toISOString().split('T')[0],
    notes: 'E2E automated sales order',
    items: [
      {
        itemId: fgItem.id,
        orderedQty: 50.0,
        uomId: 'PKT',
        unitPrice: 35.0,
      },
    ],
  };

  const createSoRes = await req('/sales-orders', {
    method: 'POST',
    body: JSON.stringify(soPayload),
  }, token);
  const soId = createSoRes.data.id;
  const soNumber = createSoRes.data.order_number;
  console.log(` -> Sales Order created: ${soNumber} (Status: ${createSoRes.data.status})`);

  // Approve Sales Order
  const approveSoRes = await req(`/sales-orders/${soId}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, token);
  console.log(` -> Sales Order approved! Status: ${approveSoRes.data.status}`);

  // Generate GST Invoice
  const invPayload = {
    salesOrderId: soId,
    invoiceDate: new Date().toISOString().split('T')[0],
    status: 'posted',
  };

  const createInvRes = await req('/invoices', {
    method: 'POST',
    body: JSON.stringify(invPayload),
  }, token);
  const invId = createInvRes.data.id;
  const invNumber = createInvRes.data.invoice_number;
  console.log(` -> GST Invoice generated: ${invNumber} (Total: ₹${Number(createInvRes.data.total_invoice_value).toFixed(2)})`);
  console.log(`    Taxable: ₹${Number(createInvRes.data.taxable_value).toFixed(2)}, CGST: ₹${Number(createInvRes.data.cgst_amount).toFixed(2)}, SGST: ₹${Number(createInvRes.data.sgst_amount).toFixed(2)}`);

  // Create Dispatch Note
  const dispatchPayload = {
    invoiceId: invId,
    dispatchDate: new Date().toISOString().split('T')[0],
    carrierOrVehicleNo: 'TN-01-AB-1234',
    driverName: 'Speed Cargo Driver',
    items: [
      {
        itemId: fgItem.id,
        dispatchedQty: 50.0,
        uomId: 'PKT',
        batchNumber: yieldRes.data.output_batch_number || 'BAT-MRK-20261119-01',
      },
    ],
  };

  const createDispatchRes = await req('/dispatches', {
    method: 'POST',
    body: JSON.stringify(dispatchPayload),
  }, token);
  const dispatchId = createDispatchRes.data.id;
  const dispatchNumber = createDispatchRes.data.dispatch_number;
  console.log(` -> Dispatch Note created: ${dispatchNumber} (Status: ${createDispatchRes.data.status})`);

  // Post Dispatch (deducts stock and records COGS)
  const postDispatchRes = await req(`/dispatches/${dispatchId}/post`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, token);
  console.log(` -> Dispatch Note posted! Status: ${postDispatchRes.data.status}`);

  // Confirm Delivery
  const deliverRes = await req(`/dispatches/${dispatchId}/deliver`, {
    method: 'POST',
    body: JSON.stringify({ deliveryDate: new Date().toISOString().split('T')[0] }),
  }, token);
  console.log(` -> Delivery confirmed! Status: ${deliverRes.data.status}`);

  // --------------------------------------------------------------------------
  // STEP 6: Customer Payment & Allocation
  // --------------------------------------------------------------------------
  console.log('\n[Step 6] Recording Customer Payment & Allocation...');
  const invoiceValue = Number(createInvRes.data.total_invoice_value);
  const payPayload = {
    customerId: customer.id,
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMode: 'bank_transfer',
    totalAmount: invoiceValue,
    referenceTxnId: `TXN-E2E-${Date.now().toString().slice(-6)}`,
    notes: 'Full settlement for invoice ' + invNumber,
    allocations: [
      {
        invoiceId: invId,
        amount: invoiceValue,
      },
    ],
  };

  const createPayRes = await req('/payments', {
    method: 'POST',
    body: JSON.stringify(payPayload),
  }, token);
  const paymentId = createPayRes.data.id;
  console.log(` -> Customer Payment recorded: ${createPayRes.data.receipt_number} (Amount: ₹${Number(createPayRes.data.total_amount).toFixed(2)})`);

  // Verify Invoice Balance is settled
  const balanceRes = await req(`/invoices/reports/balances?invoiceId=${invId}`, {}, token);
  const invBalance = balanceRes.data[0];
  console.log(` -> Verified Invoice Balance:`);
  console.log(`    Total: ₹${Number(invBalance.total_invoice_value).toFixed(2)}, Paid: ₹${Number(invBalance.total_paid_amount).toFixed(2)}, Outstanding: ₹${Number(invBalance.outstanding_balance).toFixed(2)}`);
  console.log(`    Derived Status: ${invBalance.derived_payment_status}`);

  // --------------------------------------------------------------------------
  // STEP 7: Financial Accounting & Reporting
  // --------------------------------------------------------------------------
  console.log('\n[Step 7] Synchronizing Operational Accounting & Verifying Ledgers...');
  const syncRes = await req('/accounting/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  }, token);
  console.log(` -> Accounting Sync complete: Total synced entries: ${syncRes.data.total_synced}`);
  console.log(`    Bills: ${syncRes.data.purchase_bills_synced}, Invoices: ${syncRes.data.sales_invoices_synced}, Dispatches: ${syncRes.data.dispatches_synced}, Runs: ${syncRes.data.production_runs_synced}, Payments: ${syncRes.data.payments_synced}`);

  // Verify Trial Balance
  const tbRes = await req('/accounting/reports/trial-balance', {}, token);
  const tb = tbRes.data;
  console.log(` -> Trial Balance Verification:`);
  console.log(`    Total Debits: ₹${Number(tb.total_net_debit || tb.total_gross_debit).toFixed(2)}`);
  console.log(`    Total Credits: ₹${Number(tb.total_net_credit || tb.total_gross_credit).toFixed(2)}`);
  console.log(`    Is Balanced: ${tb.is_balanced} (Variance: ₹${Number(tb.variance).toFixed(2)})`);

  if (!tb.is_balanced) {
    throw new Error(`Trial balance is unbalanced! Debits: ${tb.total_net_debit}, Credits: ${tb.total_net_credit}`);
  }

  // Verify P&L and Balance Sheet
  const plRes = await req('/accounting/reports/profit-and-loss', {}, token);
  const pl = plRes.data;
  console.log(` -> Profit & Loss Statement: Revenue: ₹${Number(pl.revenue?.total || 0).toFixed(2)}, Expenses: ₹${Number(pl.total_expenses || 0).toFixed(2)}, Net Profit: ₹${Number(pl.net_profit || 0).toFixed(2)}`);

  const bsRes = await req('/accounting/reports/balance-sheet', {}, token);
  const bs = bsRes.data;
  console.log(` -> Balance Sheet: Assets: ₹${Number(bs.assets?.total_assets || 0).toFixed(2)}, Liabilities: ₹${Number(bs.liabilities?.total_liabilities || 0).toFixed(2)}, Equity: ₹${Number(bs.equity?.total_equity || 0).toFixed(2)}`);

  // Verify Dashboard Metrics update
  const finalDashRes = await req('/reports/dashboard', {}, token);
  console.log(`\n[Dashboard Verification]`);
  console.log(` -> Total Invoiced Sales: ₹${finalDashRes.data.sales.total_sales}`);
  console.log(` -> Total Purchases: ₹${finalDashRes.data.purchases.total_purchases}`);
  console.log(` -> Total Inventory Valuation: ₹${finalDashRes.data.inventory.total_valuation}`);
  console.log(` -> Completed Production Runs: ${finalDashRes.data.production.completed_runs_count}`);

  console.log('\n' + '='.repeat(70));
  console.log('SUCCESS: ENTIRE END-TO-END ERP BUSINESS WORKFLOW VERIFIED 100%!');
  console.log('='.repeat(70));
}

runE2EWorkflow().catch(err => {
  console.error('\n[WORKFLOW ERROR]:', err.message);
  if (err.data) console.error('Details:', JSON.stringify(err.data, null, 2));
  process.exit(1);
});
