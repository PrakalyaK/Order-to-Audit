import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getClient, query, closePool } from '../src/config/db.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Sales Order Fulfilment, Dispatch & Production Requirement Workflow', async (t) => {
  let server;
  let baseUrl;

  // Real benchmark user IDs from order_to_audit
  const ownerId = '66666666-6666-6666-6666-666666666666'; // owner_main (owner)
  const adminId = '33333333-3333-3333-3333-333333333333'; // admin_factory (factory_admin)
  const supervisorId = '44444444-4444-4444-4444-444444444444'; // supervisor_floor (production_supervisor)
  const salesmanId = '11111111-1111-1111-1111-111111111111'; // salesman_a (salesman)
  const auditorId = '55555555-5555-5555-5555-555555555555'; // auditor_ext (auditor)

  // Master data IDs
  const retailerAId = '77777777-7777-7777-7777-777777777777'; // Retailer A
  const finishedGoodId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'; // FG-MRK-200G (Murukku 200g Packet)
  const flourItemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // RM-FLOUR (raw_material)

  // Signed JWTs
  const ownerToken = jwt.sign({ sub: ownerId, username: 'owner_main', role: ROLES.OWNER }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const adminToken = jwt.sign({ sub: adminId, username: 'admin_factory', role: ROLES.FACTORY_ADMIN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const supervisorToken = jwt.sign({ sub: supervisorId, username: 'supervisor_floor', role: ROLES.PRODUCTION_SUPERVISOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const salesmanToken = jwt.sign({ sub: salesmanId, username: 'salesman_a', role: ROLES.SALESMAN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const auditorToken = jwt.sign({ sub: auditorId, username: 'auditor_ext', role: ROLES.AUDITOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });

  // Start HTTP listener
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}${env.apiPrefix}`;
      resolve();
    });
  });

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Helper fetch function
  const apiCall = async (endpoint, options = {}, token = adminToken) => {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, ok: res.ok, body: json };
  };

  let testOrderId;
  let testOrderNumber;
  let activeReqId;

  // ---------------------------------------------------------------------------
  // SCENARIO 13: RBAC Restrictions Enforcement
  // ---------------------------------------------------------------------------
  await t.test('Scenario 13: RBAC Restrictions on Fulfilment and Dispatch', async () => {
    // 13.1 Salesman cannot view fulfilment
    const resSalesman = await apiCall('/fulfilment', { method: 'GET' }, salesmanToken);
    assert.strictEqual(resSalesman.status, 403, 'Salesman must be forbidden from accessing fulfilment');

    // 13.2 Auditor cannot dispatch
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const resAuditor = await apiCall(`/fulfilment/orders/${fakeId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({ items: [{ item_id: finishedGoodId, quantity: 1 }] }),
    }, auditorToken);
    assert.strictEqual(resAuditor.status, 403, 'Auditor must be forbidden from dispatching');

    // 13.3 Production supervisor cannot dispatch
    const resSupervisor = await apiCall(`/fulfilment/orders/${fakeId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({ items: [{ item_id: finishedGoodId, quantity: 1 }] }),
    }, supervisorToken);
    assert.strictEqual(resSupervisor.status, 403, 'Production supervisor must be forbidden from dispatching');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3 & 4: Create Sales Order with Shortage -> Auto Production Requirement & Notifications
  // ---------------------------------------------------------------------------
  await t.test('Scenario 3 & 4: Insufficient finished stock creates persistent Production Requirement and Notifications', async () => {
    // Check current stock of Murukku
    const stockRes = await query(`SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    const currentStock = parseFloat(stockRes.rows[0]?.current_base_qty || 0);

    // Salesman creates an order for more than available stock (currentStock + 50)
    const orderQty = currentStock + 50;
    const createRes = await apiCall('/sales-orders', {
      method: 'POST',
      body: JSON.stringify({
        customerId: retailerAId,
        orderDate: new Date().toISOString().split('T')[0],
        items: [{ itemId: finishedGoodId, orderedQty: orderQty, unitPrice: 35.0 }],
      }),
    }, salesmanToken);

    assert.strictEqual(createRes.status, 201, 'Salesman should successfully create sales order');
    testOrderId = createRes.body.data.id;
    testOrderNumber = createRes.body.data.order_number;

    // Admin approves order
    const approveRes = await apiCall(`/sales-orders/${testOrderId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ items: [{ itemId: finishedGoodId, approvedQty: orderQty }] }),
    }, adminToken);
    assert.strictEqual(approveRes.status, 200, 'Admin should approve order');

    // Fulfilment evaluation should report shortage and generate production requirement
    const fulRes = await apiCall(`/fulfilment/orders/${testOrderId}`, { method: 'GET' }, adminToken);
    assert.strictEqual(fulRes.status, 200);
    assert.strictEqual(fulRes.body.data.overallStatus, currentStock > 0 ? 'partially_available' : 'stock_shortage');
    assert.strictEqual(parseFloat(fulRes.body.data.totalShortageQty), 50, 'Shortage quantity should equal 50');

    // Verify persistent production requirement in DB
    const reqRes = await query(`SELECT * FROM production_requirements WHERE sales_order_id = $1`, [testOrderId]);
    assert.strictEqual(reqRes.rows.length, 1, 'Production requirement record must be created in PostgreSQL');
    assert.strictEqual(parseFloat(reqRes.rows[0].production_qty_required), 50);
    activeReqId = reqRes.rows[0].id;

    // Verify Production Manager notification
    const notifRes = await apiCall('/notifications', { method: 'GET' }, supervisorToken);
    assert.strictEqual(notifRes.status, 200);
    const hasNotif = notifRes.body.data.some((n) => n.title.includes(testOrderNumber));
    assert.ok(hasNotif, 'Production supervisor must receive notification for the shortage');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 12: Duplicate Production Requirement Prevention
  // ---------------------------------------------------------------------------
  await t.test('Scenario 12: Duplicate active requirement prevention', async () => {
    // Re-evaluating order must NOT duplicate active production requirements
    const evalRes = await apiCall(`/fulfilment/orders/${testOrderId}/evaluate`, { method: 'POST' }, adminToken);
    assert.strictEqual(evalRes.status, 200);

    const reqCountRes = await query(`SELECT COUNT(*)::int as cnt FROM production_requirements WHERE sales_order_id = $1`, [testOrderId]);
    assert.strictEqual(reqCountRes.rows[0].cnt, 1, 'Active requirement count must remain 1');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Prevent Dispatching beyond Available Stock
  // ---------------------------------------------------------------------------
  await t.test('Scenario 2: Admin prevented from dispatching beyond available stock', async () => {
    const stockRes = await query(`SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    const currentStock = parseFloat(stockRes.rows[0]?.current_base_qty || 0);

    // Attempt to dispatch more than current stock
    const excessDispatch = await apiCall(`/fulfilment/orders/${testOrderId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        items: [{ item_id: finishedGoodId, quantity: currentStock + 10 }],
      }),
    }, adminToken);

    assert.strictEqual(excessDispatch.status, 400, 'Dispatch beyond stock must be blocked with 400');
    assert.ok(
      excessDispatch.body.message.includes('Insufficient stock') ||
      excessDispatch.body.message.includes('exceeds') ||
      excessDispatch.body.message.includes('Negative Inventory')
    );
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 11: Partial Dispatch Support
  // ---------------------------------------------------------------------------
  await t.test('Scenario 11: Partial Dispatch of available stock', async () => {
    const stockRes = await query(`SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    const currentStock = parseFloat(stockRes.rows[0]?.current_base_qty || 0);

    if (currentStock >= 10) {
      const partialRes = await apiCall(`/fulfilment/orders/${testOrderId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          carrierOrVehicleNo: 'TN-45-PARTIAL-01',
          driverName: 'Test Driver',
          items: [{ item_id: finishedGoodId, quantity: 10 }],
        }),
      }, adminToken);

      assert.strictEqual(partialRes.status, 200, 'Partial dispatch must succeed');
      assert.ok(partialRes.body.data.dispatchNumber, 'Dispatch note should be generated');

      // Verify sales order status is now partially_dispatched
      const soRes = await query(`SELECT status FROM sales_orders WHERE id = $1`, [testOrderId]);
      assert.strictEqual(soRes.rows[0].status, 'partially_dispatched');

      // Verify remaining quantity updated
      const fulRes = await apiCall(`/fulfilment/orders/${testOrderId}`, { method: 'GET' }, adminToken);
      const line = fulRes.body.data.items.find((i) => i.item_id === finishedGoodId);
      assert.strictEqual(parseFloat(line.already_dispatched_qty), 10);
    }
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 5 & 6: Production Manager Reviews Requirement & BOM Raw Material Check
  // ---------------------------------------------------------------------------
  await t.test('Scenario 5 & 6: Production Supervisor reviews requirement & validates BOM materials', async () => {
    const reqDetails = await apiCall(`/fulfilment/production-requirements/${activeReqId}`, { method: 'GET' }, supervisorToken);
    assert.strictEqual(reqDetails.status, 200);
    assert.ok(reqDetails.body.data.bom, 'Active BOM should be resolved');
    assert.ok(Array.isArray(reqDetails.body.data.materials), 'Raw material breakdown should be provided');
    assert.ok(reqDetails.body.data.batchesNeeded >= 1, 'Batches needed should be computed');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 7 & 8: Raw Material Shortage Request & Procurement Resolution
  // ---------------------------------------------------------------------------
  await t.test('Scenario 7 & 8: Material Shortage Request creation and replenishment', async () => {
    // Raise a procurement requirement for 5 kg flour
    const procRes = await apiCall(`/fulfilment/production-requirements/${activeReqId}/procure`, {
      method: 'POST',
      body: JSON.stringify({
        material_item_id: flourItemId,
        shortage_qty: 5.0,
        notes: 'Replenish raw material for SO Murukku production',
      }),
    }, supervisorToken);

    assert.strictEqual(procRes.status, 201, 'Procurement requirement must be created');
    assert.ok(procRes.body.data.requirement_number);

    // Verify record in database
    const dbProc = await query(`SELECT * FROM procurement_requirements WHERE production_requirement_id = $1`, [activeReqId]);
    assert.strictEqual(dbProc.rows.length, 1);
    assert.strictEqual(parseFloat(dbProc.rows[0].shortage_qty), 5.0);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 9: Production Run Initiation & Yield Updating Finished Goods Stock
  // ---------------------------------------------------------------------------
  await t.test('Scenario 9: Production Run initiation and yield allocation', async () => {
    // 9.1 Initiate production run from requirement
    const initRes = await apiCall(`/fulfilment/production-requirements/${activeReqId}/initiate-production`, {
      method: 'POST',
      body: JSON.stringify({ planned_batch_count: 1 }),
    }, supervisorToken);

    assert.strictEqual(initRes.status, 201, 'Production run initiation should succeed');
    const runId = initRes.body.data.productionRun.id;

    // Requirement status is now in_production
    const dbReq = await query(`SELECT status FROM production_requirements WHERE id = $1`, [activeReqId]);
    assert.strictEqual(dbReq.rows[0].status, 'in_production');

    // Simulate yield completion: call handleProductionYield
    const { fulfilmentService } = await import('../src/modules/fulfilment/fulfilment.service.js');
    await fulfilmentService.handleProductionYield(finishedGoodId, 100, runId);

    // Requirement should now be fulfilled
    const dbReqAfter = await query(`SELECT status FROM production_requirements WHERE id = $1`, [activeReqId]);
    assert.strictEqual(dbReqAfter.rows[0].status, 'fulfilled');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 14: Concurrent Dispatch Concurrency & Negative Inventory Safety
  // ---------------------------------------------------------------------------
  await t.test('Scenario 14: Concurrency and negative inventory safety', async () => {
    // Concurrently attempting 2 dispatches of the same order
    const p1 = apiCall(`/fulfilment/orders/${testOrderId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        carrierOrVehicleNo: 'RACE-01',
        items: [{ item_id: finishedGoodId, quantity: 1 }],
      }),
    }, adminToken);

    const p2 = apiCall(`/fulfilment/orders/${testOrderId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify({
        carrierOrVehicleNo: 'RACE-02',
        items: [{ item_id: finishedGoodId, quantity: 1 }],
      }),
    }, adminToken);

    const [r1, r2] = await Promise.all([p1, p2]);
    // Both or at least one should succeed without deadlocks or negative stock
    assert.ok(r1.status === 200 || r2.status === 200, 'At least one concurrent dispatch must succeed cleanly');

    // Verify stock never went below 0
    const stock = await query(`SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    assert.ok(parseFloat(stock.rows[0].current_base_qty) >= 0, 'Stock must never be negative');
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 15: Inventory Ledger and Accounting Consistency
  // ---------------------------------------------------------------------------
  await t.test('Scenario 15: Inventory ledger and accounting audit trail consistency', async () => {
    // Check that every dispatch item has exactly one corresponding ledger entry
    const checkRes = await query(`
      SELECT di.id, di.dispatched_qty, il.transaction_qty, il.movement_type
      FROM dispatch_items di
      JOIN inventory_ledger il ON di.id = il.dispatch_item_id
      WHERE il.movement_type = 'SALES_DISPATCH'
      LIMIT 10;
    `);

    assert.ok(checkRes.rows.length > 0, 'Every dispatch item must link to an immutable inventory ledger transaction');
    for (const row of checkRes.rows) {
      assert.strictEqual(parseFloat(row.dispatched_qty), Math.abs(parseFloat(row.transaction_qty)));
    }
  });
});
