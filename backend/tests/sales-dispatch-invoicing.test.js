import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getClient, query, closePool } from '../src/config/db.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Phase 7 Sales, Dispatch & Invoicing Integration Tests', async (t) => {
  let server;
  let baseUrl;

  // Real benchmark user IDs from order_to_audit
  const ownerId = '66666666-6666-6666-6666-666666666666'; // owner_main (owner)
  const adminId = '33333333-3333-3333-3333-333333333333'; // admin_factory (factory_admin)
  const supervisorId = '44444444-4444-4444-4444-444444444444'; // supervisor_floor (production_supervisor)
  const salesmanId = '11111111-1111-1111-1111-111111111111'; // salesman_a (salesman)
  const auditorId = '55555555-5555-5555-5555-555555555555'; // auditor_ext (auditor)

  // Master data IDs
  const retailerAId = '77777777-7777-7777-7777-777777777777'; // Retailer A (Tamil Nadu, state_code 33)
  const wholesalerBId = '88888888-8888-8888-8888-888888888888'; // Wholesaler B (Karnataka, state_code 29)
  const supplierId = '99999999-9999-9999-9999-999999999999'; // Trichy Agro Supplies (party_type: supplier)
  const finishedGoodId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'; // FG-MRK-200G (Murukku 200g Packet)
  const flourItemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // RM-FLOUR (raw_material)

  // Signed JWTs
  const ownerToken = jwt.sign({ sub: ownerId, username: 'owner_main', role: ROLES.OWNER }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const adminToken = jwt.sign({ sub: adminId, username: 'admin_factory', role: ROLES.FACTORY_ADMIN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const supervisorToken = jwt.sign({ sub: supervisorId, username: 'supervisor_floor', role: ROLES.PRODUCTION_SUPERVISOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const salesmanToken = jwt.sign({ sub: salesmanId, username: 'salesman_a', role: ROLES.SALESMAN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const auditorToken = jwt.sign({ sub: auditorId, username: 'auditor_ext', role: ROLES.AUDITOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });

  // Clean any test residue from previous runs safely
  const preClient = await getClient();
  try {
    await preClient.query('SET session_replication_role = replica');
    await preClient.query(`DELETE FROM inventory_ledger WHERE source_reference_label LIKE 'DSP-2026-%' AND source_reference_label <> 'DSP-2026-0001'`);
    await preClient.query(`DELETE FROM dispatch_items WHERE dispatch_id NOT IN ('dd000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM dispatches WHERE id NOT IN ('dd000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM invoice_items WHERE invoice_id NOT IN ('ca000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM invoices WHERE id NOT IN ('ca000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM sales_order_items WHERE sales_order_id NOT IN ('aa000001-0000-0000-0000-000000000001', 'aa000002-0000-0000-0000-000000000002')`);
    await preClient.query(`DELETE FROM sales_orders WHERE id NOT IN ('aa000001-0000-0000-0000-000000000001', 'aa000002-0000-0000-0000-000000000002')`);
  } finally {
    preClient.release();
  }

  // Snapshot initial counts
  const initialCountsRes = await query(`
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
      (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
  `);
  const initialCounts = initialCountsRes.rows[0];

  // Snapshot initial finished good stock balance
  const initialStockRes = await query(
    `SELECT current_base_qty, current_moving_wac, current_total_value FROM item_stock_balances WHERE item_id = $1`,
    [finishedGoodId]
  );
  const initialFgStock = initialStockRes.rows[0];

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
    await closePool();
  });

  let createdSalesOrderId;
  let createdInterstateOrderId;
  let createdInvoiceId;
  let createdInterstateInvoiceId;
  let createdDispatchId;

  // ==========================================================================
  // 1. SALES ORDER MANAGEMENT
  // ==========================================================================

  await t.test('1. Sales Order List: GET /api/v1/sales-orders returns benchmark orders', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length >= 2, 'Should include at least the 2 benchmark orders');
  });

  await t.test('2. Sales Order Validation: Rejects supplier party', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        customerId: supplierId,
        items: [{ itemId: finishedGoodId, orderedQty: 10 }],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /supplier/i);
  });

  await t.test('3. Sales Order Validation: Rejects raw material items', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        items: [{ itemId: flourItemId, orderedQty: 10 }],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /finished goods/i);
  });

  await t.test('4. Sales Order Creation: Salesman submits valid order with stock availability check', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        notes: 'Test urgent customer order',
        items: [
          {
            itemId: finishedGoodId,
            orderedQty: 20,
            unitPrice: 50.00,
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.match(body.data.order_number, /^SO-\d{4}-\d{4}$/);
    assert.equal(body.data.status, 'submitted');
    assert.equal(Number(body.data.subtotal_amount), 1000.00); // 20 * 50
    assert.equal(Number(body.data.estimated_tax_amount), 50.00); // 5% GST on 1000
    assert.equal(Number(body.data.total_order_value), 1050.00);
    assert.ok(body.data.stockAvailability, 'Should provide real-time stock availability check');
    assert.equal(body.data.stockAvailability.isFullyInStock, true);

    createdSalesOrderId = body.data.id;
  });

  await t.test('5. Salesman Isolation: Salesman can view their own orders', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sales-orders/${createdSalesOrderId}`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.id, createdSalesOrderId);
    assert.equal(body.data.salesman_id, salesmanId);
  });

  await t.test('6. Sales Order Update: Salesman can modify submitted order', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sales-orders/${createdSalesOrderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        notes: 'Updated order notes with special delivery instructions',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.notes, 'Updated order notes with special delivery instructions');
  });

  await t.test('7. Sales Order Rejection: Admin can reject order with reason', async () => {
    // Create throwaway order to reject
    const createRes = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        items: [{ itemId: finishedGoodId, orderedQty: 5 }],
      }),
    });
    const orderToReject = (await createRes.json()).data;

    const res = await fetch(`${baseUrl}/api/v1/sales-orders/${orderToReject.id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        rejectionReason: 'Customer credit limit exceeded. Order rejected.',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'rejected');
    assert.equal(body.data.rejection_reason, 'Customer credit limit exceeded. Order rejected.');
  });

  await t.test('8. Sales Order Cancellation: Salesman can cancel submitted order', async () => {
    // Create throwaway order to cancel
    const createRes = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        items: [{ itemId: finishedGoodId, orderedQty: 5 }],
      }),
    });
    const orderToCancel = (await createRes.json()).data;

    const res = await fetch(`${baseUrl}/api/v1/sales-orders/${orderToCancel.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'cancelled');
  });

  await t.test('9. Sales Order Approval: Admin approves submitted order', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sales-orders/${createdSalesOrderId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        items: [{ itemId: finishedGoodId, approvedQty: 20 }],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'approved');
    assert.equal(Number(body.data.items[0].approved_qty), 20);
  });

  // ==========================================================================
  // 2. SALES INVOICING & GST RULES
  // ==========================================================================

  await t.test('10. Tax Invoice Generation (Intra-state CGST + SGST): Generates 50/50 tax split', async () => {
    const res = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        salesOrderId: createdSalesOrderId,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.match(body.data.invoice_number, /^INV\/\d{4}-\d{2}\/\d{4}$/);
    assert.equal(body.data.is_interstate, false);
    assert.equal(body.data.status, 'posted');
    assert.equal(Number(body.data.taxable_value), 1000.00);
    assert.equal(Number(body.data.cgst_amount), 25.00); // 2.5%
    assert.equal(Number(body.data.sgst_amount), 25.00); // 2.5%
    assert.equal(Number(body.data.igst_amount), 0.00);
    assert.equal(Number(body.data.total_invoice_value), 1050.00);

    createdInvoiceId = body.data.id;

    // Verify sales order status transitioned to 'invoiced'
    const orderCheck = await query(`SELECT status FROM sales_orders WHERE id = $1`, [createdSalesOrderId]);
    assert.equal(orderCheck.rows[0].status, 'invoiced');
  });

  await t.test('11. Tax Invoice Generation (Interstate IGST): Generates 100% IGST', async () => {
    // Create and approve an interstate order for Wholesaler B (Karnataka, state_code 29)
    const orderRes = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: wholesalerBId,
        items: [{ itemId: finishedGoodId, orderedQty: 10, unitPrice: 50.00 }],
      }),
    });
    const interstateOrder = (await orderRes.json()).data;
    createdInterstateOrderId = interstateOrder.id;

    // Approve order
    await fetch(`${baseUrl}/api/v1/sales-orders/${interstateOrder.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // Invoice interstate order
    const invRes = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        salesOrderId: interstateOrder.id,
      }),
    });

    assert.equal(invRes.status, 201);
    const invBody = await invRes.json();
    assert.equal(invBody.data.is_interstate, true);
    assert.equal(Number(invBody.data.taxable_value), 500.00);
    assert.equal(Number(invBody.data.cgst_amount), 0.00);
    assert.equal(Number(invBody.data.sgst_amount), 0.00);
    assert.equal(Number(invBody.data.igst_amount), 25.00); // 5% IGST on 500
    assert.equal(Number(invBody.data.total_invoice_value), 525.00);

    createdInterstateInvoiceId = invBody.data.id;
  });

  await t.test('12. Duplicate Invoice Prevention: Rejects second invoice for same sales order', async () => {
    const res = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        salesOrderId: createdSalesOrderId,
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /cannot be invoiced|already exists/i);
  });

  await t.test('13. Invoice Cancellation: Cancelling invoice reverts sales order status to approved', async () => {
    const res = await fetch(`${baseUrl}/api/v1/invoices/${createdInterstateInvoiceId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'cancelled');

    // Verify sales order was reverted to approved
    const orderCheck = await query(`SELECT status FROM sales_orders WHERE id = $1`, [createdInterstateOrderId]);
    assert.equal(orderCheck.rows[0].status, 'approved');
  });

  // ==========================================================================
  // 3. DISPATCH MANAGEMENT & ATOMIC INVENTORY DEDUCTION
  // ==========================================================================

  await t.test('14. Dispatch Note Creation: Creates dispatch note in ready status', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dispatches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: createdInvoiceId,
        carrierOrVehicleNo: 'TN-45-AB-1234',
        driverName: 'Ramu',
        items: [
          {
            itemId: finishedGoodId,
            batchNumber: 'MRK-2026-B1',
            dispatchedQty: 20,
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.match(body.data.dispatch_number, /^DSP-\d{4}-\d{4}$/);
    assert.equal(body.data.status, 'ready');
    assert.equal(Number(body.data.items[0].dispatched_qty), 20);

    createdDispatchId = body.data.id;
  });

  await t.test('15. Over-Dispatch Prevention: Rejects dispatch quantity exceeding invoiced quantity', async () => {
    // Create new order, invoice, and attempt over-dispatch
    const oRes = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        items: [{ itemId: finishedGoodId, orderedQty: 5 }],
      }),
    });
    const orderData = (await oRes.json()).data;
    await fetch(`${baseUrl}/api/v1/sales-orders/${orderData.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const invRes = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ salesOrderId: orderData.id }),
    });
    const invData = (await invRes.json()).data;

    // Over-dispatch attempt (5 ordered/invoiced, dispatch 10)
    const dispRes = await fetch(`${baseUrl}/api/v1/dispatches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: invData.id,
        items: [{ itemId: finishedGoodId, batchNumber: 'B1', dispatchedQty: 10 }],
      }),
    });

    assert.equal(dispRes.status, 400);
    const dispBody = await dispRes.json();
    assert.match(dispBody.message, /Over-Dispatch Prevention|exceeds invoiced quantity/i);
  });

  await t.test('16. Duplicate Dispatch Prevention: Rejects second dispatch note for same invoice', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dispatches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: createdInvoiceId,
        items: [{ itemId: finishedGoodId, batchNumber: 'B1', dispatchedQty: 20 }],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /already exists/i);
  });

  await t.test('17. Negative Inventory Prevention: Database posting engine rejects dispatch exceeding available stock', async () => {
    // 1. Create order, invoice, and dispatch note for 500 pkts (available stock is ~88 pkts)
    const oRes = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        items: [{ itemId: finishedGoodId, orderedQty: 500 }],
      }),
    });
    const excessiveOrder = (await oRes.json()).data;

    await fetch(`${baseUrl}/api/v1/sales-orders/${excessiveOrder.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    const iRes = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ salesOrderId: excessiveOrder.id }),
    });
    const excessiveInvoice = (await iRes.json()).data;

    const dRes = await fetch(`${baseUrl}/api/v1/dispatches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        invoiceId: excessiveInvoice.id,
        items: [{ itemId: finishedGoodId, batchNumber: 'B-EXCESS', dispatchedQty: 500 }],
      }),
    });
    const excessiveDispatch = (await dRes.json()).data;

    // 2. Post dispatch: must fail with 400 due to database check
    const postRes = await fetch(`${baseUrl}/api/v1/dispatches/${excessiveDispatch.id}/post`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(postRes.status, 400);
    const postBody = await postRes.json();
    assert.match(postBody.message, /Negative Inventory Prevention|Insufficient finished stock/i);
  });

  await t.test('18. Atomic Sales Dispatch Posting: Deducts finished goods at Moving WAC and synchronizes statuses', async () => {
    const stockBeforeRes = await query(
      `SELECT current_base_qty, current_moving_wac, current_total_value FROM item_stock_balances WHERE item_id = $1`,
      [finishedGoodId]
    );
    const stockBefore = stockBeforeRes.rows[0];

    const res = await fetch(`${baseUrl}/api/v1/dispatches/${createdDispatchId}/post`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'dispatched');

    // Verify stock balance was deducted by exactly 20 pkts
    const stockAfterRes = await query(
      `SELECT current_base_qty, current_moving_wac, current_total_value FROM item_stock_balances WHERE item_id = $1`,
      [finishedGoodId]
    );
    const stockAfter = stockAfterRes.rows[0];

    assert.equal(Number(stockAfter.current_base_qty), Number(stockBefore.current_base_qty) - 20);
    // Moving WAC rate remains invariant on dispatch
    assert.equal(Number(stockAfter.current_moving_wac), Number(stockBefore.current_moving_wac));

    // Verify inventory ledger transaction
    const ledgerRes = await query(
      `SELECT * FROM inventory_ledger WHERE dispatch_item_id = $1`,
      [body.data.items[0].id]
    );
    assert.equal(ledgerRes.rows.length, 1);
    const ledger = ledgerRes.rows[0];
    assert.equal(ledger.movement_type, 'SALES_DISPATCH');
    assert.equal(Number(ledger.base_quantity_delta), -20);
    assert.equal(Number(ledger.unit_cost), Number(stockBefore.current_moving_wac));
    assert.equal(Number(ledger.total_cost), Math.round(-20 * Number(stockBefore.current_moving_wac) * 100) / 100);

    // Verify status synchronization across Invoice and Sales Order
    const invCheck = await query(`SELECT status FROM invoices WHERE id = $1`, [createdInvoiceId]);
    assert.equal(invCheck.rows[0].status, 'dispatched');

    const soCheck = await query(`SELECT status FROM sales_orders WHERE id = $1`, [createdSalesOrderId]);
    assert.equal(soCheck.rows[0].status, 'dispatched');
  });

  await t.test('19. Delivery Confirmation: Marks dispatch as delivered', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dispatches/${createdDispatchId}/deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        notes: 'Signed proof of delivery received by customer',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'delivered');
  });

  // ==========================================================================
  // 4. FINANCIAL ANALYTICS, COGS & STATUTORY REPORTS
  // ==========================================================================

  await t.test('20. COGS & Margin Analytics: Calculates Cost of Goods Sold and Gross Margin %', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dispatches/${createdDispatchId}/cogs`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.dispatch_number, (await dispatchesRepository.findById(createdDispatchId)).dispatch_number);
    assert.equal(Number(body.data.taxable_revenue), 1000.00);
    assert.ok(Number(body.data.cogs_total) > 0, 'COGS total should be calculated from ledger');
    assert.ok(Number(body.data.gross_profit) > 0, 'Gross profit should be positive');
    assert.ok(Number(body.data.gross_margin_pct) > 0, 'Gross margin percentage should be positive');
    assert.ok(Array.isArray(body.data.items));
  });

  await t.test('21. Statutory View: GSTR Outward Supplies Register (v_gst_outward_summary)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/invoices/reports/gst-outward`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0, 'Should aggregate outward supplies from view');
  });

  await t.test('22. Statutory View: Customer Receivables & Outstanding (v_customer_outstanding)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/invoices/reports/customer-outstanding`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
    const retailer = body.data.find((c) => c.customer_id === retailerAId);
    assert.ok(retailer, 'Retailer A should appear in customer outstanding view');
    assert.ok(Number(retailer.total_billed) > 0);
  });

  await t.test('23. Statutory View: Invoice Balances & Derived Status (v_invoice_balances)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/invoices/reports/balances?invoiceId=${createdInvoiceId}`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].invoice_id, createdInvoiceId);
    assert.equal(body.data[0].derived_payment_status, 'unpaid');
    assert.equal(Number(body.data[0].outstanding_balance), 1050.00);
  });

  // ==========================================================================
  // 5. IMMUTABILITY GUARDS & AUDIT TRAIL
  // ==========================================================================

  await t.test('24. Immutability Enforcers: Prevents modification or deletion of dispatched records', async () => {
    // 1. Modifying dispatched sales order status is rejected
    await assert.rejects(
      async () => {
        await query(`UPDATE sales_orders SET status = 'submitted' WHERE id = $1`, [createdSalesOrderId]);
      },
      /Integrity Violation: Sales order .* is dispatched and immutable/i
    );

    // 2. Modifying items on dispatched sales order is rejected
    await assert.rejects(
      async () => {
        await query(
          `UPDATE sales_order_items SET ordered_qty = 999 WHERE sales_order_id = $1`,
          [createdSalesOrderId]
        );
      },
      /Integrity Violation: Cannot modify items on sales order .* in status "dispatched"/i
    );

    // 3. Deleting dispatched sales order is rejected
    await assert.rejects(
      async () => {
        await query(`DELETE FROM sales_orders WHERE id = $1`, [createdSalesOrderId]);
      },
      /Integrity Violation: Cannot delete sales order .* in status "dispatched"/i
    );

    // 4. Deleting posted/dispatched invoice is rejected
    await assert.rejects(
      async () => {
        await query(`DELETE FROM invoices WHERE id = $1`, [createdInvoiceId]);
      },
      /Statutory Audit Violation: Cannot delete invoice/i
    );
  });

  // ==========================================================================
  // 6. RBAC RESTRICTIONS
  // ==========================================================================

  await t.test('25. RBAC Restrictions: Salesman cannot generate invoices or approve orders (403)', async () => {
    const invRes = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({ salesOrderId: createdSalesOrderId }),
    });
    assert.equal(invRes.status, 403);

    const appRes = await fetch(`${baseUrl}/api/v1/sales-orders/${createdSalesOrderId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
    });
    assert.equal(appRes.status, 403);
  });

  await t.test('26. RBAC Restrictions: Auditor cannot create orders or dispatches (403)', async () => {
    const orderRes = await fetch(`${baseUrl}/api/v1/sales-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorToken}`,
      },
      body: JSON.stringify({
        customerId: retailerAId,
        items: [{ itemId: finishedGoodId, orderedQty: 5 }],
      }),
    });
    assert.equal(orderRes.status, 403);

    const dispRes = await fetch(`${baseUrl}/api/v1/dispatches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorToken}`,
      },
      body: JSON.stringify({
        invoiceId: createdInvoiceId,
        items: [{ itemId: finishedGoodId, batchNumber: 'B1', dispatchedQty: 5 }],
      }),
    });
    assert.equal(dispRes.status, 403);
  });

  // ==========================================================================
  // 7. TEARDOWN & BENCHMARK RESTORATION
  // ==========================================================================

  await t.test('27. Teardown: Safely clean up test sales records and verify benchmark invariance', async () => {
    const cleanClient = await getClient();
    try {
      // Use replica role to bypass immutability triggers on test records
      await cleanClient.query('SET session_replication_role = replica;');

      // Delete non-benchmark ledger rows
      await cleanClient.query(`DELETE FROM inventory_ledger WHERE source_reference_label LIKE 'DSP-2026-%' AND source_reference_label <> 'DSP-2026-0001'`);

      // Delete non-benchmark dispatch items and dispatches
      await cleanClient.query(`DELETE FROM dispatch_items WHERE dispatch_id NOT IN ('dd000001-0000-0000-0000-000000000001')`);
      await cleanClient.query(`DELETE FROM dispatches WHERE id NOT IN ('dd000001-0000-0000-0000-000000000001')`);

      // Delete non-benchmark invoice items and invoices
      await cleanClient.query(`DELETE FROM invoice_items WHERE invoice_id NOT IN ('ca000001-0000-0000-0000-000000000001')`);
      await cleanClient.query(`DELETE FROM invoices WHERE id NOT IN ('ca000001-0000-0000-0000-000000000001')`);

      // Delete non-benchmark sales order items and sales orders
      await cleanClient.query(`DELETE FROM sales_order_items WHERE sales_order_id NOT IN ('aa000001-0000-0000-0000-000000000001', 'aa000002-0000-0000-0000-000000000002')`);
      await cleanClient.query(`DELETE FROM sales_orders WHERE id NOT IN ('aa000001-0000-0000-0000-000000000001', 'aa000002-0000-0000-0000-000000000002')`);

      // Restore finished goods stock balance to pristine initial state
      await cleanClient.query(
        `UPDATE item_stock_balances 
         SET current_base_qty = $1, current_moving_wac = $2, current_total_value = $3 
         WHERE item_id = $4`,
        [initialFgStock.current_base_qty, initialFgStock.current_moving_wac, initialFgStock.current_total_value, finishedGoodId]
      );
    } finally {
      cleanClient.release();
    }

    // Verify benchmark database counts match initial state exactly
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
        (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
    `);
    const finalCounts = finalCountsRes.rows[0];

    assert.deepEqual(finalCounts, initialCounts, 'Database counts must match initial benchmark counts exactly');
  });
});
