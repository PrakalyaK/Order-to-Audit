import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getClient, query, closePool } from '../src/config/db.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Phase 6 Production Management & Costing Integration Tests', async (t) => {
  let server;
  let baseUrl;

  // Real benchmark user IDs from order_to_audit
  const ownerId = '66666666-6666-6666-6666-666666666666'; // owner_main (owner)
  const adminId = '33333333-3333-3333-3333-333333333333'; // admin_factory (factory_admin)
  const supervisorId = '44444444-4444-4444-4444-444444444444'; // supervisor_floor (production_supervisor)
  const salesmanId = '11111111-1111-1111-1111-111111111111'; // salesman_a (salesman)
  const auditorId = '55555555-5555-5555-5555-555555555555'; // auditor_ext (auditor)

  // Master data IDs
  const bomId = 'b0000001-0000-0000-0000-000000000001'; // Murukku 200g BOM
  const finishedGoodId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'; // FG-MRK-200G
  const supplierId = '99999999-9999-9999-9999-999999999999'; // Trichy Agro Supplies
  const flourItemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // RM-FLOUR
  const oilItemId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // RM-OIL
  const spicesItemId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // RM-SPICE-MIX
  const pouchItemId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; // PK-POUCH-200G

  // Clean any test residue from previous runs safely
  const preClient = await getClient();
  try {
    await preClient.query('SET session_replication_role = replica');
    await preClient.query(`DELETE FROM inventory_ledger WHERE source_reference_label LIKE 'PR-TEST-%' OR source_reference_label LIKE 'PR-%' AND source_reference_label <> 'PR-2026-11-001'`);
    await preClient.query(`DELETE FROM inventory_ledger WHERE source_reference_label LIKE 'TEST-%'`);
    await preClient.query(`DELETE FROM production_run_costing WHERE production_run_id NOT IN ('da000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM production_run_overheads WHERE production_run_id NOT IN ('da000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM production_run_inputs WHERE production_run_id NOT IN ('da000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM production_runs WHERE id NOT IN ('da000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM purchase_bill_items WHERE purchase_bill_id NOT IN ('ba000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM purchase_bills WHERE id NOT IN ('ba000001-0000-0000-0000-000000000001')`);
    await preClient.query(`DELETE FROM audit_logs WHERE entity_id NOT IN ('da000001-0000-0000-0000-000000000001', 'ba000001-0000-0000-0000-000000000001', 'b0000001-0000-0000-0000-000000000001') AND created_at > NOW() - INTERVAL '1 hour'`);
    await preClient.query('SET session_replication_role = origin');
  } finally {
    preClient.release();
  }

  // Snapshot initial counts and stock balances
  const initialCountsRes = await query(`
    SELECT 
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM items) AS items,
      (SELECT COUNT(*)::int FROM boms) AS boms,
      (SELECT COUNT(*)::int FROM parties) AS parties,
      (SELECT COUNT(*)::int FROM purchase_bills) AS purchase_bills,
      (SELECT COUNT(*)::int FROM production_runs) AS production_runs,
      (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
  `);
  const initialCounts = initialCountsRes.rows[0];

  const initialStockRes = await query('SELECT item_id, current_base_qty, current_moving_wac, current_total_value FROM item_stock_balances');
  const initialStockBalances = initialStockRes.rows;

  // Signed JWTs
  const ownerToken = jwt.sign({ sub: ownerId, username: 'owner_main', role: ROLES.OWNER }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const adminToken = jwt.sign({ sub: adminId, username: 'admin_factory', role: ROLES.FACTORY_ADMIN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const supervisorToken = jwt.sign({ sub: supervisorId, username: 'supervisor_floor', role: ROLES.PRODUCTION_SUPERVISOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const salesmanToken = jwt.sign({ sub: salesmanId, username: 'salesman_a', role: ROLES.SALESMAN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const auditorToken = jwt.sign({ sub: auditorId, username: 'auditor_ext', role: ROLES.AUDITOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });

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

  // ==========================================================================
  // 1. QUERY & BENCHMARK READ TESTS
  // ==========================================================================

  await t.test('1. Production List: GET /api/v1/production returns paginated production runs with benchmark run', async () => {
    const res = await fetch(`${baseUrl}/api/v1/production`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.data.length >= 1);
    const benchmarkRun = body.data.data.find((r) => r.run_number === 'PR-2026-11-001');
    assert.ok(benchmarkRun, 'Benchmark production run PR-2026-11-001 must exist');
    assert.equal(benchmarkRun.status, 'completed');
  });

  await t.test('2. Production Details: GET /api/v1/production/:id returns run details with inputs, overheads and costing', async () => {
    const benchmarkId = 'da000001-0000-0000-0000-000000000001';
    const res = await fetch(`${baseUrl}/api/v1/production/${benchmarkId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.run_number, 'PR-2026-11-001');
    assert.equal(body.data.inputs.length, 5, 'Must have 5 input lines');
    assert.equal(body.data.overheads.length, 2, 'Must have 2 overhead lines');
    assert.ok(body.data.costing, 'Must have batch costing record');
  });

  await t.test('3. Production Variance: GET /api/v1/production/:id/variance returns mass balance & variance from view', async () => {
    const benchmarkId = 'da000001-0000-0000-0000-000000000001';
    const res = await fetch(`${baseUrl}/api/v1/production/${benchmarkId}/variance`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.run_number, 'PR-2026-11-001');
    assert.equal(body.data.actual_good_output_qty, 188.0);
    assert.equal(body.data.yield_variance_pct, -6.0);
    assert.equal(body.data.is_yield_flagged, true);
    assert.ok(body.data.materials.length >= 5);
  });

  await t.test('4. Production Costing: GET /api/v1/production/:id/costing returns batch costing breakdown', async () => {
    const benchmarkId = 'da000001-0000-0000-0000-000000000001';
    const res = await fetch(`${baseUrl}/api/v1/production/${benchmarkId}/costing`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.costing.good_output_units, '188.0000');
    assert.equal(parseFloat(body.data.costing.cost_per_packet), 31.1436, 'Cost per packet must be ~₹31.1436');
  });

  // ==========================================================================
  // 2. VALIDATION & CREATION TESTS
  // ==========================================================================

  await t.test('5. Production Validation: Rejects non-existent BOM', async () => {
    const res = await fetch(`${baseUrl}/api/v1/production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        bom_id: '00000000-0000-0000-0000-000000000000',
        run_date: '2026-11-21',
        planned_batch_count: 1.0,
      }),
    });
    assert.equal(res.status, 404);
  });

  await t.test('6. Production Validation: Rejects invalid planned_batch_count <= 0', async () => {
    const res = await fetch(`${baseUrl}/api/v1/production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        bom_id: bomId,
        run_date: '2026-11-21',
        planned_batch_count: -1.0,
      }),
    });
    assert.equal(res.status, 400);
  });

  let draftRunId;

  await t.test('7. Production Creation: Successfully creates draft production run with snapshot inputs', async () => {
    const res = await fetch(`${baseUrl}/api/v1/production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        bom_id: bomId,
        run_date: '2026-11-21',
        planned_batch_count: 1.0,
        output_batch_number: 'BAT-MRK-TEST-001',
        notes: 'Test production run',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'draft');
    assert.equal(body.data.planned_yield_qty, '200.0000');
    assert.equal(body.data.inputs.length, 5);
    draftRunId = body.data.id;
  });

  await t.test('8. Production Cancellation: Successfully cancels draft production run', async () => {
    const res = await fetch(`${baseUrl}/api/v1/production/${draftRunId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ notes: 'Cancelled for testing' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'cancelled');
  });

  // ==========================================================================
  // 3. MATERIAL ISSUE & ATOMIC POSTING TESTS
  // ==========================================================================

  let activeRunId;

  await t.test('9. Production Creation: Create second draft run for execution', async () => {
    const res = await fetch(`${baseUrl}/api/v1/production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        bom_id: bomId,
        run_date: '2026-11-21',
        planned_batch_count: 1.0,
        output_batch_number: 'BAT-MRK-TEST-002',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    activeRunId = body.data.id;
  });

  await t.test('10. Material Issue: fn_post_production_issue deducts materials and transitions to materials_issued', async () => {
    // Initial flour closing stock
    const preStockRes = await query(`SELECT current_base_qty, current_moving_wac FROM item_stock_balances WHERE item_id = $1`, [flourItemId]);
    const preFlourQty = parseFloat(preStockRes.rows[0].current_base_qty);

    const res = await fetch(`${baseUrl}/api/v1/production/${activeRunId}/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'materials_issued');

    // Verify flour stock was decremented by 40kg
    const postStockRes = await query(`SELECT current_base_qty, current_moving_wac FROM item_stock_balances WHERE item_id = $1`, [flourItemId]);
    const postFlourQty = parseFloat(postStockRes.rows[0].current_base_qty);
    assert.equal(Math.round((preFlourQty - postFlourQty) * 1000) / 1000, 40.0, 'Flour stock should decrease by 40 kg');

    // Verify inventory ledger records
    const ledgerRes = await query(`
      SELECT movement_type, base_quantity_delta, unit_cost, total_cost 
      FROM inventory_ledger 
      WHERE production_run_input_id IN (SELECT id FROM production_run_inputs WHERE production_run_id = $1)
    `, [activeRunId]);
    assert.equal(ledgerRes.rows.length, 5, 'Should have 5 ledger entries for 5 issued inputs');
    for (const row of ledgerRes.rows) {
      assert.equal(row.movement_type, 'PRODUCTION_ISSUE');
      assert.ok(parseFloat(row.base_quantity_delta) < 0, 'Delta must be negative');
    }
  });

  await t.test('11. Immutability Guard: Rejects cancellation or duplicate issue once materials are issued', async () => {
    // Try to issue again (duplicate issue)
    const issueRes = await fetch(`${baseUrl}/api/v1/production/${activeRunId}/issue`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(issueRes.status, 400);

    // Try to cancel run
    const cancelRes = await fetch(`${baseUrl}/api/v1/production/${activeRunId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(cancelRes.status, 400);
  });

  // ==========================================================================
  // 4. PRODUCTION YIELD & COSTING TESTS
  // ==========================================================================

  await t.test('12. Production Yield: fn_post_production_yield posts output, computes WAC and costing', async () => {
    const preFgStockRes = await query(`SELECT current_base_qty, current_total_value FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    const preFgQty = parseFloat(preFgStockRes.rows[0].current_base_qty);

    const res = await fetch(`${baseUrl}/api/v1/production/${activeRunId}/yield`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        actual_good_output_qty: 195.0,
        actual_scrap_output_qty: 5.0,
        overheads: [
          { overhead_type: 'labour', description: 'Batch frying labour', amount: 1000.0 },
          { overhead_type: 'power_gas', description: 'Gas burner power', amount: 500.0 },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.status, 'completed');
    assert.equal(body.data.actual_good_output_qty, '195.0000');
    assert.ok(body.data.costing);

    // Verify finished good stock incremented by 195 pkts
    const postFgStockRes = await query(`SELECT current_base_qty, current_total_value FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    const postFgQty = parseFloat(postFgStockRes.rows[0].current_base_qty);
    assert.equal(Math.round((postFgQty - preFgQty) * 1000) / 1000, 195.0, 'Finished goods stock should increase by 195 pkts');

    // Verify inventory ledger yield record
    const yieldLedgerRes = await query(`
      SELECT movement_type, base_quantity_delta, total_cost 
      FROM inventory_ledger 
      WHERE production_run_yield_id = $1
    `, [activeRunId]);
    assert.equal(yieldLedgerRes.rows.length, 1);
    assert.equal(yieldLedgerRes.rows[0].movement_type, 'PRODUCTION_YIELD');
    assert.equal(parseFloat(yieldLedgerRes.rows[0].base_quantity_delta), 195.0);
  });

  await t.test('13. Immutability Guard: Rejects posting yield again on completed run', async () => {
    const res = await fetch(`${baseUrl}/api/v1/production/${activeRunId}/yield`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({ actual_good_output_qty: 195.0 }),
    });
    assert.equal(res.status, 400);
  });

  // ==========================================================================
  // 5. RBAC RESTRICTIONS
  // ==========================================================================

  await t.test('14. RBAC: Salesman is forbidden from all production endpoints (403)', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/production`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(listRes.status, 403);

    const postRes = await fetch(`${baseUrl}/api/v1/production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        bom_id: bomId,
        run_date: '2026-11-21',
      }),
    });
    assert.equal(postRes.status, 403);
  });

  await t.test('15. RBAC: Auditor can view production runs but cannot create, issue or yield (403)', async () => {
    // Read: Allowed
    const readRes = await fetch(`${baseUrl}/api/v1/production/${activeRunId}`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(readRes.status, 200);

    // Create: Forbidden
    const createRes = await fetch(`${baseUrl}/api/v1/production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorToken}`,
      },
      body: JSON.stringify({
        bom_id: bomId,
        run_date: '2026-11-21',
      }),
    });
    assert.equal(createRes.status, 403);
  });

  // ==========================================================================
  // 6. END-TO-END WORKFLOW (The Final Acceptance Criterion)
  // Purchase -> Inventory Stock Increase -> Issue to Production -> Yield & Costing -> FG Stock Increase
  // ==========================================================================

  await t.test('16. End-to-End Workflow: Purchase receipt increases raw material stock, subsequently consumed by production run to produce finished goods', async () => {
    // 1. Check initial Spices stock
    const spicePreRes = await query(`SELECT current_base_qty, current_moving_wac FROM item_stock_balances WHERE item_id = $1`, [spicesItemId]);
    const initialSpiceQty = parseFloat(spicePreRes.rows[0].current_base_qty);

    // 2. Create and receive a purchase bill for Spices (10 kg @ ₹220/kg)
    const purchaseRes = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        bill_number: 'TEST-E2E-PURCHASE-01',
        supplier_id: supplierId,
        bill_date: '2026-11-21',
        items: [
          {
            item_id: oilItemId,
            quantity: 20.0,
            uom_id: 'L',
            unit_rate: 140.0,
            gst_rate_pct: 5.0,
          },
          {
            item_id: spicesItemId,
            quantity: 10.0,
            uom_id: 'KG',
            unit_rate: 220.0,
            gst_rate_pct: 5.0,
          },
          {
            item_id: pouchItemId,
            quantity: 200.0,
            uom_id: 'PCS',
            unit_rate: 2.5,
            gst_rate_pct: 18.0,
          },
        ],
      }),
    });
    assert.equal(purchaseRes.status, 201);
    const purchaseData = await purchaseRes.json();
    const purchaseId = purchaseData.data.purchase.id;

    // Receive purchase bill
    const receiveRes = await fetch(`${baseUrl}/api/v1/purchases/${purchaseId}/receive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(receiveRes.status, 200);

    // Verify Spices stock increased by 10 kg
    const spicePostPurchaseRes = await query(`SELECT current_base_qty, current_moving_wac FROM item_stock_balances WHERE item_id = $1`, [spicesItemId]);
    const postPurchaseSpiceQty = parseFloat(spicePostPurchaseRes.rows[0].current_base_qty);
    assert.equal(Math.round((postPurchaseSpiceQty - initialSpiceQty) * 1000) / 1000, 10.0);

    // 3. Create a production run that consumes Spices
    const prodRes = await fetch(`${baseUrl}/api/v1/production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        bom_id: bomId,
        run_date: '2026-11-21',
        planned_batch_count: 1.0,
        output_batch_number: 'BAT-MRK-E2E-001',
      }),
    });
    assert.equal(prodRes.status, 201);
    const prodData = await prodRes.json();
    const e2eRunId = prodData.data.id;

    // 4. Issue materials
    const issueRes = await fetch(`${baseUrl}/api/v1/production/${e2eRunId}/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(issueRes.status, 200);

    // Verify Spices stock decreased by 1.2 kg (BOM requirement for 1 batch)
    const spicePostIssueRes = await query(`SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`, [spicesItemId]);
    const postIssueSpiceQty = parseFloat(spicePostIssueRes.rows[0].current_base_qty);
    assert.equal(Math.round((postPurchaseSpiceQty - postIssueSpiceQty) * 1000) / 1000, 1.2);

    // 5. Complete run & record yield
    const fgPreYieldRes = await query(`SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    const preYieldFgQty = parseFloat(fgPreYieldRes.rows[0].current_base_qty);

    const yieldRes = await fetch(`${baseUrl}/api/v1/production/${e2eRunId}/yield`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        actual_good_output_qty: 198.0,
        actual_scrap_output_qty: 2.0,
        overheads: [
          { overhead_type: 'labour', description: 'Batch frying & packing', amount: 1200.0 },
          { overhead_type: 'power_gas', description: 'LPG Gas', amount: 600.0 },
        ],
      }),
    });
    assert.equal(yieldRes.status, 200);
    const completedData = await yieldRes.json();
    assert.equal(completedData.data.status, 'completed');
    assert.equal(completedData.data.actual_good_output_qty, '198.0000');

    // 6. Verify Finished Goods stock increased by exactly 198 pkts
    const fgPostYieldRes = await query(`SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`, [finishedGoodId]);
    const postYieldFgQty = parseFloat(fgPostYieldRes.rows[0].current_base_qty);
    assert.equal(Math.round((postYieldFgQty - preYieldFgQty) * 1000) / 1000, 198.0);
  });

  // ==========================================================================
  // 7. TEARDOWN & BENCHMARK RESTORATION
  // ==========================================================================

  await t.test('17. Teardown: Clean up test purchases, runs, and restore pristine benchmark database', async () => {
    const postClient = await getClient();
    try {
      await postClient.query('SET session_replication_role = replica');

      // Clean up ledger entries
      await postClient.query(`DELETE FROM inventory_ledger WHERE source_reference_label LIKE 'PR-TEST-%' OR source_reference_label LIKE 'TEST-%' OR source_reference_label LIKE 'PR-%' AND source_reference_label <> 'PR-2026-11-001'`);

      // Clean up test production runs and related tables
      await postClient.query(`DELETE FROM production_run_costing WHERE production_run_id NOT IN ('da000001-0000-0000-0000-000000000001')`);
      await postClient.query(`DELETE FROM production_run_overheads WHERE production_run_id NOT IN ('da000001-0000-0000-0000-000000000001')`);
      await postClient.query(`DELETE FROM production_run_inputs WHERE production_run_id NOT IN ('da000001-0000-0000-0000-000000000001')`);
      await postClient.query(`DELETE FROM production_runs WHERE id NOT IN ('da000001-0000-0000-0000-000000000001')`);

      // Clean up test purchase bills
      await postClient.query(`DELETE FROM purchase_bill_items WHERE purchase_bill_id NOT IN ('ba000001-0000-0000-0000-000000000001')`);
      await postClient.query(`DELETE FROM purchase_bills WHERE id NOT IN ('ba000001-0000-0000-0000-000000000001')`);

      // Clean up test audit logs
      await postClient.query(`
        DELETE FROM audit_logs 
        WHERE entity_id NOT IN (
          'da000001-0000-0000-0000-000000000001',
          'ba000001-0000-0000-0000-000000000001',
          'b0000001-0000-0000-0000-000000000001'
        ) AND created_at > NOW() - INTERVAL '1 hour'
      `);

      // Restore exact initial stock balances
      for (const bal of initialStockBalances) {
        await postClient.query(`
          UPDATE item_stock_balances
          SET current_base_qty = $1, current_moving_wac = $2, current_total_value = $3
          WHERE item_id = $4;
        `, [bal.current_base_qty, bal.current_moving_wac, bal.current_total_value, bal.item_id]);
      }

      await postClient.query('SET session_replication_role = origin');
    } finally {
      postClient.release();
    }

    // Verify benchmark counts match initial counts exactly
    const finalCountsRes = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM items) AS items,
        (SELECT COUNT(*)::int FROM boms) AS boms,
        (SELECT COUNT(*)::int FROM parties) AS parties,
        (SELECT COUNT(*)::int FROM purchase_bills) AS purchase_bills,
        (SELECT COUNT(*)::int FROM production_runs) AS production_runs,
        (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
    `);
    const finalCounts = finalCountsRes.rows[0];

    assert.deepEqual(finalCounts, initialCounts, 'Database counts must match initial benchmark counts exactly');
  });
});
