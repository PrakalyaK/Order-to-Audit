import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { query, getClient } from '../src/config/db.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Phase 8 Payment Management & Receivables Integration Tests', async (t) => {
  let server;
  let baseUrl;

  // Benchmark Users
  const ownerId = '66666666-6666-6666-6666-666666666666';
  const adminId = '33333333-3333-3333-3333-333333333333';
  const salesmanId = '11111111-1111-1111-1111-111111111111';
  const auditorId = '55555555-5555-5555-5555-555555555555';

  // Benchmark Parties
  const retailerAId = '77777777-7777-7777-7777-777777777777'; // Customer (Tamil Nadu)
  const wholesalerBId = '88888888-8888-8888-8888-888888888888'; // Customer (Karnataka)
  const supplierTrichyId = '99999999-9999-9999-9999-999999999999'; // Supplier

  // Benchmark Invoices & Payments
  const benchmarkInvoiceId = 'fa000001-0000-0000-0000-000000000001';
  const benchmarkPaymentId = 'ed000001-0000-0000-0000-000000000001';

  // JWT Tokens
  const ownerToken = jwt.sign({ sub: ownerId, username: 'owner_main', role: ROLES.OWNER }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const adminToken = jwt.sign({ sub: adminId, username: 'admin_factory', role: ROLES.FACTORY_ADMIN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const salesmanToken = jwt.sign({ sub: salesmanId, username: 'salesman_a', role: ROLES.SALESMAN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const auditorToken = jwt.sign({ sub: auditorId, username: 'auditor_ext', role: ROLES.AUDITOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });

  // Pre-clean any test residue from previous runs
  const preClient = await getClient();
  try {
    await preClient.query('SET session_replication_role = replica;');
    await preClient.query(`DELETE FROM payment_allocations WHERE payment_id NOT IN ('${benchmarkPaymentId}');`);
    await preClient.query(`DELETE FROM payments WHERE id NOT IN ('${benchmarkPaymentId}');`);
    await preClient.query(`DELETE FROM invoice_items WHERE invoice_id NOT IN ('${benchmarkInvoiceId}');`);
    await preClient.query(`DELETE FROM invoices WHERE id NOT IN ('${benchmarkInvoiceId}');`);
    await preClient.query(`DELETE FROM sales_order_items WHERE sales_order_id NOT IN ('ea000001-0000-0000-0000-000000000001', 'ea000002-0000-0000-0000-000000000002');`);
    await preClient.query(`DELETE FROM sales_orders WHERE id NOT IN ('ea000001-0000-0000-0000-000000000001', 'ea000002-0000-0000-0000-000000000002');`);
    await preClient.query('SET session_replication_role = origin;');
  } finally {
    preClient.release();
  }

  // Snapshot initial benchmark counts
  const countRes = await query(`
    SELECT 
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM items) AS items,
      (SELECT COUNT(*)::int FROM boms) AS boms,
      (SELECT COUNT(*)::int FROM parties) AS parties,
      (SELECT COUNT(*)::int FROM purchase_bills) AS purchase_bills,
      (SELECT COUNT(*)::int FROM production_runs) AS production_runs,
      (SELECT COUNT(*)::int FROM sales_orders) AS sales_orders,
      (SELECT COUNT(*)::int FROM invoices) AS invoices,
      (SELECT COUNT(*)::int FROM dispatches) AS dispatches,
      (SELECT COUNT(*)::int FROM payments) AS payments,
      (SELECT COUNT(*)::int FROM payment_allocations) AS payment_allocations,
      (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
  `);
  const initialCounts = countRes.rows[0];

  t.before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Test tracking variables
  let testInvoice1Id;
  let testInvoice2Id;
  let testDraftPaymentId;
  let testPostedPaymentId;
  let testMultiAllocPaymentId;
  let testReversalPaymentId;

  // Setup auxiliary test invoices for Wholesaler B directly in DB to allow controlled multi-invoice tests
  t.before(async () => {
    const setupClient = await getClient();
    try {
      await setupClient.query('SET session_replication_role = replica;');

      // Create test sales order 1
      const soRes = await setupClient.query(`
        INSERT INTO sales_orders (
          order_number, customer_id, salesman_id, order_date, status, subtotal_amount, estimated_tax_amount, total_order_value
        ) VALUES (
          'SO-TEST-P8-01', '${wholesalerBId}', '${salesmanId}', '2026-11-20', 'invoiced', 5000.00, 250.00, 5250.00
        ) RETURNING id;
      `);
      const soId = soRes.rows[0].id;

      // Create test invoice 1 (Wholesaler B, ₹5,250.00)
      const inv1Res = await setupClient.query(`
        INSERT INTO invoices (
          invoice_number, financial_year, sales_order_id, customer_id, invoice_date,
          place_of_supply_state_code, is_interstate, taxable_value, cgst_amount, sgst_amount,
          igst_amount, total_invoice_value, status, approved_by
        ) VALUES (
          'INV/2026-27/9901', '2026-2027', '${soId}', '${wholesalerBId}', '2026-11-20',
          '29', true, 5000.00, 0.00, 0.00, 250.00, 5250.00, 'posted', '${adminId}'
        ) RETURNING id;
      `);
      testInvoice1Id = inv1Res.rows[0].id;

      // Create test invoice 2 (Wholesaler B, ₹3,150.00)
      const inv2Res = await setupClient.query(`
        INSERT INTO invoices (
          invoice_number, financial_year, sales_order_id, customer_id, invoice_date,
          place_of_supply_state_code, is_interstate, taxable_value, cgst_amount, sgst_amount,
          igst_amount, total_invoice_value, status, approved_by
        ) VALUES (
          'INV/2026-27/9902', '2026-2027', '${soId}', '${wholesalerBId}', '2026-11-20',
          '29', true, 3000.00, 0.00, 0.00, 150.00, 3150.00, 'posted', '${adminId}'
        ) RETURNING id;
      `);
      testInvoice2Id = inv2Res.rows[0].id;

      await setupClient.query('SET session_replication_role = origin;');
    } finally {
      setupClient.release();
    }
  });

  // ==========================================================================
  // 1. PAYMENT CREATION & VALIDATIONS
  // ==========================================================================

  await t.test('1. Payment Validation: Rejects party that is a supplier (not a customer)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: supplierTrichyId, // Supplier!
        totalAmount: 1000.00,
        paymentMode: 'bank_transfer',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.message, /not a customer/i);
  });

  await t.test('2. Payment Validation: Rejects non-positive payment amount (0 or negative)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        totalAmount: 0,
        paymentMode: 'upi',
      }),
    });

    assert.equal(res.status, 400);
  });

  await t.test('3. Draft Payment Lifecycle: Create, update details, and post payment', async () => {
    // A. Create Draft Payment
    const createRes = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        paymentDate: '2026-11-21',
        totalAmount: 2000.00,
        paymentMode: 'cheque',
        chequeNumber: 'CHQ-882190',
        bankName: 'HDFC Bank',
        status: 'draft',
        notes: 'Cheque received by salesman A at Retailer store',
      }),
    });

    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    assert.equal(createBody.data.status, 'draft');
    assert.equal(Number(createBody.data.total_amount), 2000.00);
    assert.match(createBody.data.receipt_number, /^REC-\d{4}-\d{4}$/);
    testDraftPaymentId = createBody.data.id;

    // B. Update Draft Payment
    const updateRes = await fetch(`${baseUrl}/api/v1/payments/${testDraftPaymentId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        totalAmount: 2500.00,
        bankBranch: 'T. Nagar Branch',
      }),
    });

    assert.equal(updateRes.status, 200);
    const updateBody = await updateRes.json();
    assert.equal(Number(updateBody.data.total_amount), 2500.00);
    assert.equal(updateBody.data.bank_branch, 'T. Nagar Branch');

    // C. Post Payment
    const postRes = await fetch(`${baseUrl}/api/v1/payments/${testDraftPaymentId}/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });

    assert.equal(postRes.status, 200);
    const postBody = await postRes.json();
    assert.equal(postBody.data.status, 'posted');
    assert.equal(Number(postBody.data.unallocated_amount), 2500.00);
  });

  await t.test('4. Duplicate Posting Prevention: Cannot post already posted payment', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments/${testDraftPaymentId}/post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /already posted/i);
  });

  await t.test('5. Direct Posted Payment Creation: Immediate unallocated advance recording', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: wholesalerBId,
        paymentDate: '2026-11-21',
        totalAmount: 10000.00,
        paymentMode: 'neft_rtgs',
        referenceTxnId: 'NEFT/20261121/AXIS9910',
        bankName: 'Axis Bank',
        status: 'posted',
        notes: 'Advance transfer for bulk order',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'posted');
    assert.equal(Number(body.data.total_amount), 10000.00);
    assert.equal(Number(body.data.unallocated_amount), 10000.00);
    assert.equal(body.data.allocations.length, 0);
    testPostedPaymentId = body.data.id;
  });

  // ==========================================================================
  // 2. INVOICE PAYMENT ALLOCATION & RECONCILIATION
  // ==========================================================================

  await t.test('6. Customer Mismatch Prevention: Rejects allocating payment to another customer invoice', async () => {
    // testPostedPaymentId belongs to Wholesaler B
    // benchmarkInvoiceId belongs to Retailer A
    const res = await fetch(`${baseUrl}/api/v1/payments/${testPostedPaymentId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: benchmarkInvoiceId,
        amount: 1000.00,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /Customer Mismatch/i);
  });

  await t.test('7. Partial Payment Allocation: Allocates ₹2,000 against Invoice 1 (₹5,250)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments/${testPostedPaymentId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: testInvoice1Id,
        amount: 2000.00,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(Number(body.data.total_allocated), 2000.00);
    assert.equal(Number(body.data.unallocated_amount), 8000.00); // 10,000 - 2,000

    // Check Invoice 1 status in database view
    const invCheck = await query(`SELECT * FROM v_invoice_balances WHERE invoice_id = $1`, [testInvoice1Id]);
    assert.equal(Number(invCheck.rows[0].total_paid_amount), 2000.00);
    assert.equal(Number(invCheck.rows[0].outstanding_balance), 3250.00);
    assert.equal(invCheck.rows[0].derived_payment_status, 'partially_paid');
  });

  await t.test('8. Multiple Payments Against Same Invoice: Second payment adds ₹1,000 to Invoice 1', async () => {
    // Create another payment from Wholesaler B
    const pay2Res = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: wholesalerBId,
        totalAmount: 1500.00,
        paymentMode: 'upi',
        referenceTxnId: 'UPI/20261121/PAY2',
        status: 'posted',
      }),
    });
    assert.equal(pay2Res.status, 201);
    const pay2 = await pay2Res.json();

    // Allocate ₹1,000 from Payment 2 to Invoice 1
    const allocRes = await fetch(`${baseUrl}/api/v1/payments/${pay2.data.id}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: testInvoice1Id,
        amount: 1000.00,
      }),
    });
    assert.equal(allocRes.status, 200);

    // Verify Invoice 1 now has ₹3,000 total paid from 2 separate payments
    const invCheck = await query(`SELECT * FROM v_invoice_balances WHERE invoice_id = $1`, [testInvoice1Id]);
    assert.equal(Number(invCheck.rows[0].total_paid_amount), 3000.00);
    assert.equal(Number(invCheck.rows[0].outstanding_balance), 2250.00);
    assert.equal(invCheck.rows[0].derived_payment_status, 'partially_paid');
  });

  await t.test('9. Full Payment Allocation: Settles remaining ₹2,250 of Invoice 1 to mark it paid', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments/${testPostedPaymentId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: testInvoice1Id,
        amount: 2250.00,
      }),
    });

    assert.equal(res.status, 200);

    // Verify Invoice 1 is now 100% paid
    const invCheck = await query(`SELECT * FROM v_invoice_balances WHERE invoice_id = $1`, [testInvoice1Id]);
    assert.equal(Number(invCheck.rows[0].total_paid_amount), 5250.00);
    assert.equal(Number(invCheck.rows[0].outstanding_balance), 0.00);
    assert.equal(invCheck.rows[0].derived_payment_status, 'paid');
  });

  await t.test('10. Invoice Overpayment Prevention: Rejects allocation exceeding invoice balance', async () => {
    // Invoice 1 is fully paid. Attempting to allocate even ₹1 should be rejected
    const res = await fetch(`${baseUrl}/api/v1/payments/${testPostedPaymentId}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: testInvoice1Id,
        amount: 1.00,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /Invoice Overpayment/i);
  });

  await t.test('11. Over-Allocation Prevention: Rejects allocation exceeding payment unallocated balance', async () => {
    // Create a small payment of ₹500
    const smallPayRes = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: wholesalerBId,
        totalAmount: 500.00,
        paymentMode: 'cash',
        status: 'posted',
      }),
    });
    assert.equal(smallPayRes.status, 201);
    const smallPay = await smallPayRes.json();

    // Invoice 2 has balance of ₹3,150. Attempting to allocate ₹1,000 from a ₹500 payment triggers over-allocation
    const res = await fetch(`${baseUrl}/api/v1/payments/${smallPay.data.id}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: testInvoice2Id,
        amount: 1000.00,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /Over-allocation Error/i);
  });

  await t.test('12. One Payment Allocated Across Multiple Invoices: Split allocation on creation', async () => {
    // Create new payment of ₹4,000 with initial allocations array:
    // ₹2,000 to Invoice 2, ₹1,000 to remaining advance
    const res = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: wholesalerBId,
        totalAmount: 4000.00,
        paymentMode: 'bank_transfer',
        status: 'posted',
        allocations: [
          { invoiceId: testInvoice2Id, amount: 2000.00 },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(Number(body.data.total_amount), 4000.00);
    assert.equal(Number(body.data.total_allocated), 2000.00);
    assert.equal(Number(body.data.unallocated_amount), 2000.00);
    testMultiAllocPaymentId = body.data.id;
  });

  // ==========================================================================
  // 3. PAYMENT REVERSAL & UNALLOCATION WORKFLOWS
  // ==========================================================================

  await t.test('13. Payment Reversal: Reverses posted payment and frees all its active allocations', async () => {
    // Create a payment and allocate ₹1,000 to Invoice 2
    const payRes = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: wholesalerBId,
        totalAmount: 1000.00,
        paymentMode: 'cheque',
        chequeNumber: 'CHQ-BOUNCE-01',
        status: 'posted',
        allocations: [{ invoiceId: testInvoice2Id, amount: 1000.00 }],
      }),
    });
    assert.equal(payRes.status, 201);
    const payData = await payRes.json();
    testReversalPaymentId = payData.data.id;

    // Check Invoice 2 has paid amount including this ₹1,000
    const invBefore = await query(`SELECT total_paid_amount, outstanding_balance FROM v_invoice_balances WHERE invoice_id = $1`, [testInvoice2Id]);
    const paidBefore = Number(invBefore.rows[0].total_paid_amount);

    // Reverse the payment due to bounced cheque
    const revRes = await fetch(`${baseUrl}/api/v1/payments/${testReversalPaymentId}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        reason: 'Cheque bounced due to insufficient funds (memo #BK/2026/891)',
      }),
    });

    assert.equal(revRes.status, 200);
    const revBody = await revRes.json();
    assert.equal(revBody.success, true);
    assert.equal(revBody.data.status, 'reversed');
    assert.equal(revBody.data.reversal_reason, 'Cheque bounced due to insufficient funds (memo #BK/2026/891)');
    assert.ok(revBody.data.reversed_at);

    // Verify allocations are marked reversed
    assert.equal(revBody.data.reversed_allocations.length, 1);
    assert.equal(revBody.data.active_allocations.length, 0);

    // Verify Invoice 2 outstanding balance was restored!
    const invAfter = await query(`SELECT total_paid_amount, outstanding_balance FROM v_invoice_balances WHERE invoice_id = $1`, [testInvoice2Id]);
    assert.equal(Number(invAfter.rows[0].total_paid_amount), paidBefore - 1000.00);
  });

  await t.test('14. Immutability Enforcer: Cannot DELETE or UPDATE reversed payment directly', async () => {
    // Attempting direct DELETE should be blocked by trigger
    await assert.rejects(
      async () => {
        await query(`DELETE FROM payments WHERE id = $1;`, [testReversalPaymentId]);
      },
      /Statutory Audit Violation: Cannot DELETE reversed payment/i
    );

    // Attempting direct UPDATE on core fields should be blocked
    await assert.rejects(
      async () => {
        await query(`UPDATE payments SET total_amount = 5000.00 WHERE id = $1;`, [testReversalPaymentId]);
      },
      /Statutory Audit Violation: Reversed payment .* is strictly immutable/i
    );
  });

  await t.test('15. Single Allocation Reversal (De-allocation): Restores invoice balance without voiding payment', async () => {
    // From testMultiAllocPaymentId, find the active allocation
    const payGetRes = await fetch(`${baseUrl}/api/v1/payments/${testMultiAllocPaymentId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(payGetRes.status, 200);
    const payBefore = await payGetRes.json();
    const targetAlloc = payBefore.data.active_allocations[0];
    assert.ok(targetAlloc, 'Should have active allocation');

    const revRes = await fetch(`${baseUrl}/api/v1/payments/allocations/${targetAlloc.id}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        reason: 'Allocated to wrong invoice by error, returning to on-account advance',
      }),
    });

    assert.equal(revRes.status, 200);
    const revBody = await revRes.json();
    assert.equal(revBody.success, true);
    // Payment total remains 4,000, but unallocated amount returned to 4,000!
    assert.equal(Number(revBody.data.total_amount), 4000.00);
    assert.equal(Number(revBody.data.unallocated_amount), 4000.00);
    assert.equal(revBody.data.active_allocations.length, 0);
  });

  // ==========================================================================
  // 4. STATUTORY & RECEIVABLES REPORTING
  // ==========================================================================

  await t.test('16. Receivables Summary: GET /api/v1/payments/receivables/summary', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments/receivables/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Number(body.data.total_invoiced_amount) > 0);
    assert.ok(Number(body.data.total_allocated_payments) > 0);
    assert.ok(Number(body.data.total_payments_received) > 0);
    assert.ok(Number(body.data.count_paid) >= 1);
  });

  await t.test('17. Customer Receivables: GET /api/v1/payments/receivables/customers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments/receivables/customers?customerId=${retailerAId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].customer_id, retailerAId);
    assert.equal(body.data[0].customer_name, 'Retailer A');
    assert.equal(Number(body.data[0].total_billed), 7875.00);
    assert.equal(Number(body.data[0].total_allocated_to_invoices), 4000.00);
    assert.equal(Number(body.data[0].net_invoice_receivables), 3875.00);
  });

  await t.test('18. Customer Payment History: GET /api/v1/payments/customer/:id/history', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments/customer/${retailerAId}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.customer.id, retailerAId);
    assert.ok(body.data.payments.length >= 1);
  });

  await t.test('19. Invoice Payment History: GET /api/v1/payments/invoice/:id/history', async () => {
    const res = await fetch(`${baseUrl}/api/v1/payments/invoice/${benchmarkInvoiceId}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.invoice.invoice_id, benchmarkInvoiceId);
    assert.equal(body.data.allocations.length, 1);
    assert.equal(Number(body.data.allocations[0].allocated_amount), 4000.00);
    assert.equal(body.data.allocations[0].receipt_number, 'REC-2026-0001');
  });

  // ==========================================================================
  // 5. ROLE-BASED ACCESS CONTROL (RBAC)
  // ==========================================================================

  await t.test('20. RBAC: Salesman can record draft payment, but cannot reverse payments (403)', async () => {
    const revRes = await fetch(`${baseUrl}/api/v1/payments/${testPostedPaymentId}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({ reason: 'Salesman unauthorized reversal attempt' }),
    });

    assert.equal(revRes.status, 403);
  });

  await t.test('21. RBAC: Auditor can view payments and receivables, but cannot record or reverse (403)', async () => {
    // Auditor can view
    const viewRes = await fetch(`${baseUrl}/api/v1/payments`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(viewRes.status, 200);

    // Auditor cannot create
    const postRes = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        totalAmount: 100.00,
        paymentMode: 'cash',
      }),
    });
    assert.equal(postRes.status, 403);
  });

  // ==========================================================================
  // 6. TEARDOWN & BENCHMARK RESTORATION
  // ==========================================================================

  await t.test('22. Teardown: Safely clean up test payments, allocations and verify benchmark invariance', async () => {
    const cleanClient = await getClient();
    try {
      await cleanClient.query('SET session_replication_role = replica;');

      // Delete test allocations and payments
      await cleanClient.query(`DELETE FROM payment_allocations WHERE payment_id NOT IN ('${benchmarkPaymentId}');`);
      await cleanClient.query(`DELETE FROM payments WHERE id NOT IN ('${benchmarkPaymentId}');`);

      // Delete test invoices and sales orders
      await cleanClient.query(`DELETE FROM invoice_items WHERE invoice_id NOT IN ('${benchmarkInvoiceId}');`);
      await cleanClient.query(`DELETE FROM invoices WHERE id NOT IN ('${benchmarkInvoiceId}');`);
      await cleanClient.query(`DELETE FROM sales_order_items WHERE sales_order_id NOT IN ('ea000001-0000-0000-0000-000000000001', 'ea000002-0000-0000-0000-000000000002');`);
      await cleanClient.query(`DELETE FROM sales_orders WHERE id NOT IN ('ea000001-0000-0000-0000-000000000001', 'ea000002-0000-0000-0000-000000000002');`);

      // Delete audit logs generated during this test
      await cleanClient.query(`
        DELETE FROM audit_logs 
        WHERE entity_name IN ('payments', 'payment_allocations') 
          AND entity_id NOT IN ('${benchmarkPaymentId}', 'd10aa8af-e2ad-4d86-acb9-dac6e13e3d0c')
          AND created_at > NOW() - INTERVAL '1 hour';
      `);

      await cleanClient.query('SET session_replication_role = origin;');
    } finally {
      cleanClient.release();
    }

    // Verify benchmark table counts match initial snapshot
    const finalCountsRes = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM items) AS items,
        (SELECT COUNT(*)::int FROM boms) AS boms,
        (SELECT COUNT(*)::int FROM parties) AS parties,
        (SELECT COUNT(*)::int FROM purchase_bills) AS purchase_bills,
        (SELECT COUNT(*)::int FROM production_runs) AS production_runs,
        (SELECT COUNT(*)::int FROM sales_orders) AS sales_orders,
        (SELECT COUNT(*)::int FROM invoices) AS invoices,
        (SELECT COUNT(*)::int FROM dispatches) AS dispatches,
        (SELECT COUNT(*)::int FROM payments) AS payments,
        (SELECT COUNT(*)::int FROM payment_allocations) AS payment_allocations,
        (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
    `);
    const finalCounts = finalCountsRes.rows[0];

    assert.deepEqual(finalCounts, initialCounts, 'Database counts must match pristine benchmark counts exactly');
  });
});
