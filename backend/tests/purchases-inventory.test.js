import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getClient, query, closePool } from '../src/config/db.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Phase 5 Purchases & Inventory Management Integration Tests', async (t) => {
  let server;
  let baseUrl;

  // Real benchmark user IDs from order_to_audit
  const ownerId = '66666666-6666-6666-6666-666666666666'; // owner_main (owner)
  const adminId = '33333333-3333-3333-3333-333333333333'; // admin_factory (factory_admin)
  const supervisorId = '44444444-4444-4444-4444-444444444444'; // supervisor_floor (production_supervisor)
  const salesmanId = '11111111-1111-1111-1111-111111111111'; // salesman_a (salesman)
  const auditorId = '55555555-5555-5555-5555-555555555555'; // auditor_ext (auditor)

  const supplierId = '99999999-9999-9999-9999-999999999999'; // Trichy Agro Supplies
  const customerId = '77777777-7777-7777-7777-777777777777'; // Retailer A
  const flourItemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // RM-FLOUR
  const oilItemId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // RM-OIL
  const pouchItemId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; // PK-POUCH-200G
  const finishedGoodId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'; // FG-MRK-200G

  // Clean any test residue from previous runs
  await query(`DELETE FROM inventory_ledger WHERE source_reference_label = 'TEST-BILL-001'`);
  await query(`DELETE FROM purchase_bill_items WHERE purchase_bill_id IN (SELECT id FROM purchase_bills WHERE bill_number LIKE 'TEST-%')`);
  await query(`DELETE FROM purchase_bills WHERE bill_number LIKE 'TEST-%'`);

  // Signed JWTs
  const ownerToken = jwt.sign({ sub: ownerId, username: 'owner_main', role: ROLES.OWNER }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const adminToken = jwt.sign({ sub: adminId, username: 'admin_factory', role: ROLES.FACTORY_ADMIN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const supervisorToken = jwt.sign({ sub: supervisorId, username: 'supervisor_floor', role: ROLES.PRODUCTION_SUPERVISOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const salesmanToken = jwt.sign({ sub: salesmanId, username: 'salesman_a', role: ROLES.SALESMAN }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });
  const auditorToken = jwt.sign({ sub: auditorId, username: 'auditor_ext', role: ROLES.AUDITOR }, env.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });

  // Snapshot initial counts
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

  let createdPurchaseBillId;

  // ==========================================================================
  // 1. PURCHASE MANAGEMENT TESTS
  // ==========================================================================

  await t.test('1. Purchase Creation: Successfully creates draft purchase bill with line items and GST calculation', async () => {
    const res = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        bill_number: 'TEST-BILL-001',
        bill_date: '2026-11-21',
        notes: 'Test raw material purchase order',
        items: [
          {
            item_id: flourItemId,
            quantity: 50.0,
            uom_id: 'KG',
            unit_rate: 42.00,
            supplier_batch_no: 'LOT-FL-991',
          },
          {
            item_id: oilItemId,
            quantity: 20.0,
            uom_id: 'L',
            unit_rate: 110.00,
            supplier_batch_no: 'LOT-OIL-992',
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.purchase.status, 'draft');
    assert.equal(body.data.purchase.bill_number, 'TEST-BILL-001');

    // Flour: 50 * 42 = 2100.00, GST 5% = 105.00, Total = 2205.00
    // Oil: 20 * 110 = 2200.00, GST 5% = 110.00, Total = 2310.00
    // Subtotal: 4300.00, Total Tax: 215.00
    // Intrastate (Tamil Nadu 33 -> 33): CGST = 107.50, SGST = 107.50, IGST = 0.00
    // Grand Total: 4515.00
    const p = body.data.purchase;
    assert.equal(parseFloat(p.subtotal_amount), 4300.00);
    assert.equal(parseFloat(p.cgst_amount), 107.50);
    assert.equal(parseFloat(p.sgst_amount), 107.50);
    assert.equal(parseFloat(p.igst_amount), 0.00);
    assert.equal(parseFloat(p.total_amount), 4515.00);
    assert.equal(p.items.length, 2);

    createdPurchaseBillId = p.id;
  });

  await t.test('2. Purchase Retrieval: GET /api/v1/purchases and GET /api/v1/purchases/:id', async () => {
    // List purchases
    const listRes = await fetch(`${baseUrl}/api/v1/purchases?status=draft`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.success, true);
    assert.ok(listBody.data.purchases.length >= 1);

    // Get purchase by ID
    const getRes = await fetch(`${baseUrl}/api/v1/purchases/${createdPurchaseBillId}`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.success, true);
    assert.equal(getBody.data.purchase.id, createdPurchaseBillId);
    assert.equal(getBody.data.purchase.items.length, 2);
  });

  await t.test('3. Purchase Validation: Rejects party that is a customer (not a supplier)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        supplier_id: customerId, // Retailer A is a customer, not supplier
        bill_number: 'TEST-BILL-INVALID-SUPPLIER',
        bill_date: '2026-11-21',
        items: [{ item_id: flourItemId, quantity: 10.0, uom_id: 'KG', unit_rate: 40.00 }],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('not a supplier'));
  });

  await t.test('4. Purchase Validation: Rejects finished good items in purchase bill', async () => {
    const res = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        bill_number: 'TEST-BILL-FG',
        bill_date: '2026-11-21',
        items: [{ item_id: finishedGoodId, quantity: 10.0, uom_id: 'PKT', unit_rate: 35.00 }],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('finished_good'));
  });

  await t.test('5. Purchase Validation: Rejects duplicate bill number for the same supplier', async () => {
    const res = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        bill_number: 'TEST-BILL-001', // Already created in Test 1
        bill_date: '2026-11-21',
        items: [{ item_id: flourItemId, quantity: 10.0, uom_id: 'KG', unit_rate: 40.00 }],
      }),
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.ok(body.message.includes('already exists'));
  });

  await t.test('6. Purchase Update: Modifies unposted draft purchase bill', async () => {
    const res = await fetch(`${baseUrl}/api/v1/purchases/${createdPurchaseBillId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        notes: 'Updated supplier notes prior to material receipt',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.purchase.notes, 'Updated supplier notes prior to material receipt');
  });

  await t.test('7. Purchase Cancellation: Cancels draft purchase bill', async () => {
    // Create a temporary bill to cancel
    const createRes = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        bill_number: 'TEST-BILL-CANCEL-ME',
        bill_date: '2026-11-21',
        items: [{ item_id: flourItemId, quantity: 10.0, uom_id: 'KG', unit_rate: 40.00 }],
      }),
    });
    const createBody = await createRes.json();
    const cancelBillId = createBody.data.purchase.id;

    // Cancel bill
    const cancelRes = await fetch(`${baseUrl}/api/v1/purchases/${cancelBillId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(cancelRes.status, 200);
    const cancelBody = await cancelRes.json();
    assert.equal(cancelBody.data.purchase.status, 'cancelled');

    // Receiving a cancelled bill must fail
    const receiveRes = await fetch(`${baseUrl}/api/v1/purchases/${cancelBillId}/receive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(receiveRes.status, 400);

    // Clean up temporary cancelled bill
    await query(`DELETE FROM purchase_bill_items WHERE purchase_bill_id = $1`, [cancelBillId]);
    await query(`DELETE FROM purchase_bills WHERE id = $1`, [cancelBillId]);
  });

  // ==========================================================================
  // 2. PURCHASE RECEIPT & MOVING WAC INTEGRATION (Real DB Posting Engine)
  // ==========================================================================

  await t.test('8. Purchase Receipt: fn_post_purchase_receipt updates stock balance, Moving WAC, and ledger', async () => {
    // Check stock balance before receipt for Flour and Oil
    const flourBefore = (await query(`SELECT current_base_qty, current_moving_wac, current_total_value FROM item_stock_balances WHERE item_id = $1`, [flourItemId])).rows[0];
    const initialFlourQty = parseFloat(flourBefore.current_base_qty);
    const initialFlourVal = parseFloat(flourBefore.current_total_value);

    // Receive the purchase bill created in Test 1
    // (Flour: +50 kg @ ₹42.00, Oil: +20 L @ ₹110.00)
    const receiveRes = await fetch(`${baseUrl}/api/v1/purchases/${createdPurchaseBillId}/receive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(receiveRes.status, 200);
    const receiveBody = await receiveRes.json();
    assert.equal(receiveBody.data.purchase.status, 'received');

    // Check stock balance after receipt
    const flourAfter = (await query(`SELECT current_base_qty, current_moving_wac, current_total_value FROM item_stock_balances WHERE item_id = $1`, [flourItemId])).rows[0];
    const newFlourQty = parseFloat(flourAfter.current_base_qty);
    const newFlourVal = parseFloat(flourAfter.current_total_value);
    const newFlourWac = parseFloat(flourAfter.current_moving_wac);

    // Quantity increased by exactly 50 kg
    assert.equal(newFlourQty, initialFlourQty + 50.0);
    // Value increased by exactly ₹2,100.00 (50 * 42.00)
    assert.equal(newFlourVal, Math.round((initialFlourVal + 2100.00) * 100) / 100);
    // New WAC = New Value / New Qty
    assert.equal(newFlourWac, Math.round((newFlourVal / newFlourQty) * 10000) / 10000);

    // Verify inventory_ledger has 2 new 'PURCHASE_RECEIPT' entries
    const ledgerEntries = (await query(`
      SELECT movement_type, transaction_qty, transaction_uom_id, total_cost, source_reference_label 
      FROM inventory_ledger 
      WHERE source_reference_label = 'TEST-BILL-001'
    `)).rows;
    assert.equal(ledgerEntries.length, 2);
    assert.equal(ledgerEntries[0].movement_type, 'PURCHASE_RECEIPT');

    // Duplicate receive must fail
    const dupRes = await fetch(`${baseUrl}/api/v1/purchases/${createdPurchaseBillId}/receive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(dupRes.status, 400);

    // Modification of received bill must fail
    const modRes = await fetch(`${baseUrl}/api/v1/purchases/${createdPurchaseBillId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ notes: 'Illegal update after receipt' }),
    });
    assert.equal(modRes.status, 400);
  });

  // ==========================================================================
  // 3. INVENTORY MANAGEMENT ENDPOINT TESTS
  // ==========================================================================

  await t.test('9. Inventory Stock: GET /api/v1/inventory/stock returns stock balances with Moving WAC', async () => {
    const res = await fetch(`${baseUrl}/api/v1/inventory/stock`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.stock));
    assert.ok(body.data.stock.length >= 6);

    const flourStock = body.data.stock.find((s) => s.sku === 'RM-FLOUR');
    assert.ok(flourStock);
    assert.ok(parseFloat(flourStock.closing_stock_base_qty) > 0);
    assert.ok(parseFloat(flourStock.current_moving_wac) > 0);
  });

  await t.test('10. Inventory Item Stock: GET /api/v1/inventory/stock/:itemId', async () => {
    const res = await fetch(`${baseUrl}/api/v1/inventory/stock/${flourItemId}`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.stock.sku, 'RM-FLOUR');
    assert.equal(body.data.stock.base_uom_id, 'KG');
  });

  await t.test('11. Low Stock Alerts: GET /api/v1/inventory/low-stock identifies low stock items', async () => {
    const res = await fetch(`${baseUrl}/api/v1/inventory/low-stock`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.low_stock_items));
  });

  await t.test('12. Inventory Valuation: GET /api/v1/inventory/valuation returns total valuation & breakdown', async () => {
    const res = await fetch(`${baseUrl}/api/v1/inventory/valuation`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.total_valuation > 0);
    assert.ok(Array.isArray(body.data.breakdown_by_item_type));
    assert.ok(body.data.breakdown_by_item_type.length >= 1);
  });

  await t.test('13. Stock Ledger Register: GET /api/v1/inventory/ledger returns chronological movements', async () => {
    const res = await fetch(`${baseUrl}/api/v1/inventory/ledger?movement_type=PURCHASE_RECEIPT`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.entries.length >= 1);
    assert.equal(body.data.entries[0].movement_type, 'PURCHASE_RECEIPT');
  });

  await t.test('14. Stock Availability Check: POST /api/v1/inventory/availability checks sufficient stock', async () => {
    // Request Flour (available ~170kg+) and an impossible amount of Pouch
    const res = await fetch(`${baseUrl}/api/v1/inventory/availability`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        items: [
          { item_id: flourItemId, required_qty: 20.0, uom_id: 'KG' },
          { item_id: pouchItemId, required_qty: 999999.0, uom_id: 'PCS' },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.all_sufficient, false);

    const flourCheck = body.data.items.find((i) => i.item_id === flourItemId);
    const pouchCheck = body.data.items.find((i) => i.item_id === pouchItemId);

    assert.equal(flourCheck.is_sufficient, true);
    assert.equal(flourCheck.shortfall_base_qty, 0.0);

    assert.equal(pouchCheck.is_sufficient, false);
    assert.ok(pouchCheck.shortfall_base_qty > 0);
  });

  // ==========================================================================
  // 4. RBAC RESTRICTIONS
  // ==========================================================================

  await t.test('15. RBAC Restrictions: Salesman receives 403 Forbidden on purchases', async () => {
    // GET /api/v1/purchases
    const getRes = await fetch(`${baseUrl}/api/v1/purchases`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(getRes.status, 403);

    // POST /api/v1/purchases
    const postRes = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        bill_number: 'TEST-UNAUTH',
        bill_date: '2026-11-21',
        items: [{ item_id: flourItemId, quantity: 10.0, uom_id: 'KG', unit_rate: 40.00 }],
      }),
    });
    assert.equal(postRes.status, 403);
  });

  await t.test('16. RBAC Restrictions: Auditor receives 403 Forbidden when creating or receiving purchases', async () => {
    const postRes = await fetch(`${baseUrl}/api/v1/purchases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierId,
        bill_number: 'TEST-AUDITOR-FAIL',
        bill_date: '2026-11-21',
        items: [{ item_id: flourItemId, quantity: 10.0, uom_id: 'KG', unit_rate: 40.00 }],
      }),
    });
    assert.equal(postRes.status, 403);
  });

  // ==========================================================================
  // 5. TEARDOWN & BENCHMARK RESTORATION
  // ==========================================================================

  await t.test('17. Teardown: Clean up test purchases and restore benchmark balances', async () => {
    // Clean up ledger entries created by test
    await query(`DELETE FROM inventory_ledger WHERE source_reference_label = 'TEST-BILL-001'`);
    // Clean up test purchase bill items and bill
    await query(`DELETE FROM purchase_bill_items WHERE purchase_bill_id IN (SELECT id FROM purchase_bills WHERE bill_number LIKE 'TEST-%')`);
    await query(`DELETE FROM purchase_bills WHERE bill_number LIKE 'TEST-%'`);

    // Restore Flour and Oil stock balance to pristine benchmark state
    // (Benchmark: Flour 160.0000 kg @ ₹43.1250, value ₹6,900.00; Oil 40.0000 L @ ₹100.0000, value ₹4,000.00)
    await query(`
      UPDATE item_stock_balances
      SET current_base_qty = 160.0000, current_moving_wac = 43.1250, current_total_value = 6900.00
      WHERE item_id = $1;
    `, [flourItemId]);

    await query(`
      UPDATE item_stock_balances
      SET current_base_qty = 40.0000, current_moving_wac = 100.0000, current_total_value = 4000.00
      WHERE item_id = $1;
    `, [oilItemId]);

    // Clean up audit logs from test bill
    await query(`
      DELETE FROM audit_logs 
      WHERE entity_name IN ('purchase_bills', 'purchase_bill_items') 
        AND entity_id NOT IN ('ba000001-0000-0000-0000-000000000001')
    `);

    // Verify benchmark counts are identical to start
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
