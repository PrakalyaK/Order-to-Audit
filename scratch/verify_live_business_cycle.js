/**
 * Comprehensive End-to-End Business Workflow Integration Verification
 * Tests the complete connected cycle across all modules:
 * 1. Role separation & authentication
 * 2. Shared Inventory Invariant & Benchmark State (50 + 188 - 150 = 88 pkts)
 * 3. Sales Loop: Salesman Order Submission (POST /sales-orders)
 * 4. Factory Admin Order Inspection & Approval (POST /sales-orders/:id/approve)
 * 5. GST Tax Invoicing (POST /invoices)
 * 6. Goods Dispatch (POST /dispatches & POST /dispatches/:id/post) -> Stock Ledger (SALES_DISPATCH)
 * 7. Negative Stock Prevention under over-dispatch
 * 8. Customer Payment & Receivables Allocation (POST /payments)
 * 9. 9-Report Statutory Audit Suite Verification (Sales Register, GST, Purchases, Stock Summary, Stock Ledger, Variance, Yield, Cost/Pkt, Ageing)
 * 10. Database Immutability & Audit Trail Integrity
 */

const API_BASE = 'http://localhost:5000/api/v1';

async function request(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data: json };
}

async function login(username, password) {
  const res = await request('/auth/login', 'POST', { username, password });
  const token = res.data.data?.token || res.data.data?.accessToken;
  if (!res.ok || !token) {
    throw new Error(`Login failed for ${username}: ${res.data.message || res.status}`);
  }
  return token;
}

let checksPassed = 0;
let checksFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    checksPassed++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details}`);
    checksFailed++;
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('ORDER-TO-AUDIT — FULL CONNECTED BUSINESS CYCLE VERIFICATION');
  console.log('='.repeat(80));

  // --- Step 1: Authentication & Role Verification ---
  console.log('\n--- Step 1: Authentication & Role Separation ---');
  const adminToken = await login('admin_factory', 'Password@123');
  const salesmanToken = await login('salesman_a', 'Password@123');
  const supervisorToken = await login('supervisor_floor', 'Password@123');
  const auditorToken = await login('auditor_ext', 'Password@123');

  assert(!!adminToken, 'Factory Admin logged in successfully');
  assert(!!salesmanToken, 'Salesman A logged in successfully');
  assert(!!supervisorToken, 'Production Supervisor logged in successfully');
  assert(!!auditorToken, 'Auditor logged in successfully');

  // Verify salesman cannot approve orders or generate invoices
  const dummyApproval = await request('/sales-orders/00000000-0000-0000-0000-000000000000/approve', 'POST', {}, salesmanToken);
  assert(dummyApproval.status === 403, 'Salesman forbidden from approving orders (HTTP 403)');

  const dummyInvoice = await request('/invoices', 'POST', { salesOrderId: '00000000-0000-0000-0000-000000000000' }, salesmanToken);
  assert(dummyInvoice.status === 403, 'Salesman forbidden from generating invoices (HTTP 403)');

  // --- Step 2: Shared Inventory Ledger & Benchmark State Verification ---
  console.log('\n--- Step 2: Shared Inventory Invariant & Stock Reconciliation ---');
  const stockSummaryRes = await request('/reports/stock-summary', 'GET', null, adminToken);
  assert(stockSummaryRes.ok, 'Stock summary report fetched');

  const stockRows = stockSummaryRes.data.data || stockSummaryRes.data || [];
  const murukkuStock = stockRows.find((i) => i.sku === 'FG-MRK-200G');
  assert(!!murukkuStock, 'Finished good Murukku 200g exists in stock summary');
  console.log(`    Current Murukku 200g Stock: ${murukkuStock?.current_base_qty} pkts, Valuation: ₹${murukkuStock?.current_total_value}, WAC: ₹${murukkuStock?.current_moving_wac}`);
  
  // In benchmark scenario: 50 opening + 188 produced = 238 available; 150 dispatched => 88 remaining
  assert(Number(murukkuStock.current_base_qty) === 88, 'Benchmark stock balance equals exactly 88 packets (50 + 188 - 150 = 88)');
  assert(Math.abs(Number(murukkuStock.current_moving_wac) - 30.9034) < 0.01, 'Finished Good Moving WAC equals ₹30.9034/packet');

  // --- Step 3: Sales Loop — Salesman Order Submission ---
  console.log('\n--- Step 3: Sales Loop — Order Placement by Salesman ---');
  const partiesRes = await request('/parties?type=customer', 'GET', null, salesmanToken);
  const customers = partiesRes.data.data?.parties || partiesRes.data.parties || [];
  const retailerA = customers.find((c) => c.trade_name?.includes('Retailer A')) || customers[0];
  assert(!!retailerA, `Customer located: ${retailerA?.trade_name} (ID: ${retailerA?.id})`);

  const itemsRes = await request('/items?type=finished_good', 'GET', null, salesmanToken);
  const items = itemsRes.data.data?.items || itemsRes.data.items || [];
  const murukkuItem = items.find((i) => i.sku === 'FG-MRK-200G') || items[0];
  assert(!!murukkuItem, `Finished good located: ${murukkuItem?.name} (ID: ${murukkuItem?.id})`);

  // Salesman places new order for 20 packets
  const orderPayload = {
    customerId: retailerA.id,
    orderDate: '2026-11-23',
    notes: 'Urgent order for evaluation test',
    items: [
      {
        itemId: murukkuItem.id,
        orderedQty: 20,
        unitPrice: 40.00,
      },
    ],
  };

  const createOrderRes = await request('/sales-orders', 'POST', orderPayload, salesmanToken);
  assert(createOrderRes.ok, 'Salesman created new sales order', createOrderRes.data.message);
  const order = createOrderRes.data.data?.order || createOrderRes.data.data || createOrderRes.data;
  const orderId = order.id;
  const orderNumber = order.order_number;
  console.log(`    Created Sales Order: ${orderNumber} (ID: ${orderId})`);

  // Verify initial status is submitted
  const orderDetailRes = await request(`/sales-orders/${orderId}`, 'GET', null, salesmanToken);
  const retrievedOrder = orderDetailRes.data.data?.order || orderDetailRes.data.data || orderDetailRes.data;
  assert(retrievedOrder.status === 'submitted', `Sales order status is 'submitted' (Status: ${retrievedOrder.status})`);

  // --- Step 4: Factory Admin Inspection & Approval ---
  console.log('\n--- Step 4: Factory Admin Inspection & Approval ---');
  const pendingOrdersRes = await request('/sales-orders?status=submitted', 'GET', null, adminToken);
  const pendingOrders = pendingOrdersRes.data.data?.salesOrders || pendingOrdersRes.data.salesOrders || pendingOrdersRes.data.data || [];
  const foundPending = pendingOrders.some((o) => o.id === orderId);
  assert(foundPending, 'Submitted order appears in Factory Admin Pending Approvals list');

  // Test Rejection Reason Validation: Admin cannot reject without reason
  const invalidReject = await request(`/sales-orders/${orderId}/reject`, 'POST', {}, adminToken);
  assert(invalidReject.status === 400, 'Rejection without reason is rejected with HTTP 400');

  // Admin approves order
  const approveRes = await request(`/sales-orders/${orderId}/approve`, 'POST', {}, adminToken);
  assert(approveRes.ok, 'Factory Admin approved sales order', approveRes.data.message);

  const approvedOrderCheck = await request(`/sales-orders/${orderId}`, 'GET', null, adminToken);
  const approvedOrder = approvedOrderCheck.data.data?.order || approvedOrderCheck.data.data || approvedOrderCheck.data;
  assert(approvedOrder.status === 'approved', 'Order status updated to approved');

  // --- Step 5: GST Invoice Generation ---
  console.log('\n--- Step 5: GST Invoice Generation & Tax Split ---');
  const invoicePayload = {
    salesOrderId: orderId,
    invoiceDate: '2026-11-23',
    status: 'posted',
  };

  const createInvRes = await request('/invoices', 'POST', invoicePayload, adminToken);
  assert(createInvRes.ok, 'GST Invoice created from approved order', createInvRes.data.message);
  const invoice = createInvRes.data.data?.invoice || createInvRes.data.data || createInvRes.data;
  const invoiceId = invoice.id;
  const invoiceNumber = invoice.invoice_number;
  console.log(`    Generated Tax Invoice: ${invoiceNumber} (ID: ${invoiceId})`);

  // Verify tax breakdown: 20 pkts * ₹40 = ₹800 taxable
  // Murukku GST rate is 5% in master data: CGST 2.5% (₹20) + SGST 2.5% (₹20), Total ₹840
  const taxableVal = Number(invoice.taxable_value ?? invoice.total_taxable_value);
  const cgstVal = Number(invoice.cgst_amount ?? invoice.total_cgst);
  const sgstVal = Number(invoice.sgst_amount ?? invoice.total_sgst);
  const igstVal = Number(invoice.igst_amount ?? invoice.total_igst);
  const totalVal = Number(invoice.total_invoice_value);

  assert(taxableVal === 800, `Taxable value matches ₹800.00 (Actual: ₹${taxableVal})`);
  assert(cgstVal === 20, `Intra-state CGST (2.5%) matches ₹20.00 (Actual: ₹${cgstVal})`);
  assert(sgstVal === 20, `Intra-state SGST (2.5%) matches ₹20.00 (Actual: ₹${sgstVal})`);
  assert(igstVal === 0, `Intra-state IGST matches ₹0.00 (Actual: ₹${igstVal})`);
  assert(totalVal === 840, `Total Invoice Value matches ₹840.00 (Actual: ₹${totalVal})`);

  // --- Step 6: Dispatch & Stock Ledger Relief ---
  console.log('\n--- Step 6: Goods Dispatch & Physical Stock Relief ---');
  const dispatchPayload = {
    invoiceId,
    dispatchDate: '2026-11-23',
    carrierOrVehicleNo: 'TN-45-AZ-9988',
    driverName: 'R. Murugan',
    items: [
      {
        itemId: murukkuItem.id,
        batchNumber: 'BAT-MRK-20261119-01',
        dispatchedQty: 20,
      },
    ],
  };

  const dispatchCreateRes = await request('/dispatches', 'POST', dispatchPayload, adminToken);
  assert(dispatchCreateRes.ok, 'Dispatch note created', dispatchCreateRes.data.message);
  const dispatch = dispatchCreateRes.data.data?.dispatch || dispatchCreateRes.data.data || dispatchCreateRes.data;
  const dispatchId = dispatch.id;
  const dispatchNumber = dispatch.dispatch_number;
  console.log(`    Created Dispatch Note: ${dispatchNumber} (ID: ${dispatchId})`);

  // Post dispatch to inventory ledger
  const dispatchPostRes = await request(`/dispatches/${dispatchId}/post`, 'POST', {}, adminToken);
  assert(dispatchPostRes.ok, 'Dispatch posted to inventory ledger', dispatchPostRes.data.message);

  // Verify stock decremented: 88 pkts - 20 pkts = 68 pkts remaining
  const updatedStockRes = await request('/reports/stock-summary', 'GET', null, adminToken);
  const updatedStockRows = updatedStockRes.data.data || updatedStockRes.data || [];
  const updatedMurukku = updatedStockRows.find((i) => i.sku === 'FG-MRK-200G');
  console.log(`    Updated Murukku 200g Stock: ${updatedMurukku?.current_base_qty} pkts`);
  assert(Number(updatedMurukku.current_base_qty) === 68, 'Physical stock decremented by exactly 20 packets (88 - 20 = 68 pkts)');

  // Verify stock ledger contains SALES_DISPATCH entry with source reference
  const ledgerRes = await request(`/reports/stock-ledger?sku=FG-MRK-200G`, 'GET', null, adminToken);
  const ledgerRows = ledgerRes.data.data || ledgerRes.data || [];
  const latestMovement = ledgerRows[0];
  assert(latestMovement.movement_type === 'SALES_DISPATCH', `Latest ledger entry movement_type is SALES_DISPATCH (Actual: ${latestMovement.movement_type})`);
  assert(Number(latestMovement.base_quantity_delta) === -20, `Ledger entry delta is -20 (Actual: ${latestMovement.base_quantity_delta})`);
  assert(latestMovement.source_reference_label.includes(dispatchNumber), `Source reference traceability preserved: ${latestMovement.source_reference_label}`);

  // Test Negative Stock Guard: Attempt to dispatch 500 pkts (only 68 available)
  const overDispatchPayload = {
    invoiceId,
    dispatchDate: '2026-11-23',
    items: [{ itemId: murukkuItem.id, batchNumber: 'BAT-MRK-20261119-01', dispatchedQty: 500 }],
  };
  const negativeStockAttempt = await request('/dispatches', 'POST', overDispatchPayload, adminToken);
  if (negativeStockAttempt.ok) {
    const overDispatchId = negativeStockAttempt.data.data?.dispatch?.id || negativeStockAttempt.data.data?.id;
    const postFail = await request(`/dispatches/${overDispatchId}/post`, 'POST', {}, adminToken);
    assert(!postFail.ok, 'Negative stock dispatch post blocked with error: ' + postFail.data.message);
  } else {
    assert(!negativeStockAttempt.ok, 'Negative stock dispatch creation blocked');
  }

  // --- Step 7: Customer Payment & Receivables Update ---
  console.log('\n--- Step 7: Customer Payment & Receivables Ageing Update ---');
  const paymentPayload = {
    customerId: retailerA.id,
    paymentDate: '2026-11-23',
    totalAmount: 840.00,
    paymentMode: 'bank_transfer',
    referenceTxnId: 'RTGS-TRICHY-998811',
    status: 'posted',
    notes: 'Full payment for evaluation invoice',
    allocations: [
      {
        invoiceId,
        amount: 840.00,
      },
    ],
  };

  const paymentRes = await request('/payments', 'POST', paymentPayload, adminToken);
  assert(paymentRes.ok, 'Customer payment recorded and allocated to invoice', paymentRes.data.message);

  // Verify invoice balance is now 0.00
  const invBalanceRes = await request(`/reports/sales-register`, 'GET', null, adminToken);
  const invRows = invBalanceRes.data.data || invBalanceRes.data || [];
  const paidInv = invRows.find((i) => i.id === invoiceId || i.invoice_number === invoiceNumber);
  assert(Number(paidInv.outstanding_balance) === 0, `Invoice outstanding balance reduced to ₹0.00 (Paid: ₹${paidInv.total_paid_amount})`);

  // --- Step 8: Statutory 9-Report Suite Verification ---
  console.log('\n--- Step 8: Statutory 9-Report Suite Verification ---');
  
  // 1. Sales Register
  const r1 = await request('/reports/sales-register', 'GET', null, auditorToken);
  assert(r1.ok && Array.isArray(r1.data.data || r1.data), 'Report 1: Sales Register accessible to Auditor');

  // 2. GST Outward Supplies
  const r2 = await request('/reports/sales', 'GET', null, auditorToken);
  assert(r2.ok && Array.isArray(r2.data.data?.gst_outward || r2.data.gst_outward), 'Report 2: GST Outward Supplies (GSTR-1) accessible to Auditor');

  // 3. Purchase Register
  const r3 = await request('/reports/purchase-register', 'GET', null, auditorToken);
  assert(r3.ok && Array.isArray(r3.data.data || r3.data), 'Report 3: Purchase Register accessible to Auditor');

  // 4. Stock Summary
  const r4 = await request('/reports/stock-summary', 'GET', null, auditorToken);
  assert(r4.ok && Array.isArray(r4.data.data || r4.data), 'Report 4: Perpetual Stock Summary accessible to Auditor');

  // 5. Stock Ledger
  const r5 = await request('/reports/stock-ledger', 'GET', null, auditorToken);
  assert(r5.ok && Array.isArray(r5.data.data || r5.data), 'Report 5: Append-Only Stock Ledger accessible to Auditor');

  // 6. Production Variance Report
  const r6 = await request('/reports/production', 'GET', null, auditorToken);
  assert(r6.ok && Array.isArray(r6.data.data?.variance || r6.data.variance), 'Report 6: Production Variance Report accessible to Auditor');

  // 7. Production Yield & Wastage Report
  const r7 = await request('/reports/production-yield-wastage', 'GET', null, auditorToken);
  assert(r7.ok && Array.isArray(r7.data.data || r7.data), 'Report 7: Production Yield & Wastage Report accessible to Auditor');

  // 8. Cost per Packet Report
  const r8 = await request('/reports/cost-per-packet', 'GET', null, auditorToken);
  assert(r8.ok && Array.isArray(r8.data.data || r8.data), 'Report 8: Cost per Packet Absorption Report accessible to Auditor');

  // 9. Receivables Ageing Report
  const r9 = await request('/reports/receivables-ageing', 'GET', null, auditorToken);
  assert(r9.ok && Array.isArray(r9.data.data || r9.data), 'Report 9: Payments & Receivables Ageing Report accessible to Auditor');

  // 10. Batch Traceability
  const r10 = await request('/reports/traceability/BAT-MRK-20261119-01', 'GET', null, auditorToken);
  assert(r10.ok && r10.data.data?.as_finished_good, 'Report 10: End-to-End Batch Traceability accessible to Auditor');

  // --- Step 9: Immutability & Audit Trail Integrity ---
  console.log('\n--- Step 9: Database Immutability & Security Audit ---');
  const deleteInvRes = await request(`/invoices/${invoiceId}`, 'DELETE', null, adminToken);
  assert(deleteInvRes.status === 404 || deleteInvRes.status === 405 || deleteInvRes.status === 403, 'Posted invoice cannot be deleted via API');

  // --- Final Results Summary ---
  console.log('\n' + '='.repeat(80));
  console.log(`END-TO-END VERIFICATION SUMMARY: ${checksPassed} PASSED, ${checksFailed} FAILED`);
  console.log('='.repeat(80));

  if (checksFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
