import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { query, getClient } from '../src/config/db.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Phase 10 Advanced ERP Operations Integration Tests', async (t) => {
  let server;
  let baseUrl;

  // Benchmark Users
  const ownerId = '66666666-6666-6666-6666-666666666666';
  const adminId = '33333333-3333-3333-3333-333333333333';
  const supervisorId = '44444444-4444-4444-4444-444444444444';
  const salesmanId = '11111111-1111-1111-1111-111111111111';
  const auditorId = '55555555-5555-5555-5555-555555555555';

  // Benchmark Entities
  const supplierTrichyId = '99999999-9999-9999-9999-999999999999';
  const benchmarkPurchaseBillId = 'ba000001-0000-0000-0000-000000000001'; // INV-TRICHY-842, ₹2835
  const murukkuItemId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const flourItemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const primaryWarehouseId = 'ee000001-0000-0000-0000-000000000001';
  const secondaryWarehouseId = 'ee000002-0000-0000-0000-000000000002';

  // JWT Tokens
  const ownerToken = jwt.sign(
    { sub: ownerId, username: 'owner_main', role: ROLES.OWNER },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const adminToken = jwt.sign(
    { sub: adminId, username: 'admin_factory', role: ROLES.FACTORY_ADMIN },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const supervisorToken = jwt.sign(
    { sub: supervisorId, username: 'supervisor_floor', role: ROLES.PRODUCTION_SUPERVISOR },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const salesmanToken = jwt.sign(
    { sub: salesmanId, username: 'salesman_a', role: ROLES.SALESMAN },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const auditorToken = jwt.sign(
    { sub: auditorId, username: 'auditor_ext', role: ROLES.AUDITOR },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  // Helper function to clean test data
  async function cleanTestData() {
    const client = await getClient();
    try {
      await client.query('SET session_replication_role = replica;');
      await client.query('DELETE FROM payroll_items;');
      await client.query('DELETE FROM payroll_runs;');
      await client.query('DELETE FROM employees;');
      await client.query('DELETE FROM warehouse_transfer_items;');
      await client.query('DELETE FROM warehouse_transfers;');
      await client.query(`
        DELETE FROM warehouses 
        WHERE id NOT IN ('ee000001-0000-0000-0000-000000000001', 'ee000002-0000-0000-0000-000000000002');
      `);
      await client.query('DELETE FROM supplier_payment_allocations;');
      await client.query('DELETE FROM supplier_payments;');
      await client.query('DELETE FROM stock_adjustments;');
      await client.query(`
        DELETE FROM inventory_ledger 
        WHERE movement_type IN ('WAREHOUSE_TRANSFER_OUT', 'WAREHOUSE_TRANSFER_IN', 'STOCK_ADJUSTMENT');
      `);
      await client.query(`
        DELETE FROM journal_entry_lines 
        WHERE journal_entry_id IN (
          SELECT id FROM journal_entries 
          WHERE source_type IN ('SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_REVERSAL', 'STOCK_ADJUSTMENT', 'PAYROLL_RUN', 'PAYROLL_PAYMENT')
        );
      `);
      await client.query(`
        DELETE FROM journal_entries 
        WHERE source_type IN ('SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_REVERSAL', 'STOCK_ADJUSTMENT', 'PAYROLL_RUN', 'PAYROLL_PAYMENT');
      `);

      // Reset stock balance for Murukku back to original 88.0000 and total value 2719.50
      await client.query(`
        UPDATE item_stock_balances 
        SET current_base_qty = 88.0000,
            current_total_value = 2719.50,
            current_moving_wac = 30.9034
        WHERE item_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      `);

      await client.query('SET session_replication_role = origin;');
    } finally {
      client.release();
    }
  }

  // Pre-clean
  await cleanTestData();

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
      (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger,
      (SELECT COUNT(*)::int FROM warehouses) AS warehouses,
      (SELECT COUNT(*)::int FROM chart_of_accounts WHERE is_system = true) AS system_accounts
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
    await new Promise((resolve) => server.close(resolve));
    await cleanTestData();

    // Verify benchmark counts match initial
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
        (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger,
        (SELECT COUNT(*)::int FROM warehouses) AS warehouses,
        (SELECT COUNT(*)::int FROM chart_of_accounts WHERE is_system = true) AS system_accounts
    `);
    const finalCounts = finalCountsRes.rows[0];
    assert.deepEqual(finalCounts, initialCounts, 'Benchmark database must remain strictly pristine');
  });

  // ============================================================================
  // MODULE 1: SUPPLIER PAYMENTS & ACCOUNTS PAYABLE
  // ============================================================================

  let payment1Id;
  let payment2Id;

  await t.test('1.1. Should query payables summary and outstanding supplier balances', async () => {
    const res = await fetch(`${baseUrl}/api/v1/supplier-payments/payables/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(Number(body.data.total_billed_amount), 2835);
    assert.equal(Number(body.data.total_outstanding), 2835);

    const billsRes = await fetch(`${baseUrl}/api/v1/supplier-payments/payables/bills`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(billsRes.status, 200);
    const billsBody = await billsRes.json();
    assert.equal(billsBody.success, true);
    assert.equal(billsBody.data.length, 1);
    assert.equal(billsBody.data[0].bill_number, 'INV-TRICHY-842');
    assert.equal(Number(billsBody.data[0].outstanding_balance), 2835);
  });

  await t.test('1.2. Should record partial supplier payment with immediate bill allocation', async () => {
    const res = await fetch(`${baseUrl}/api/v1/supplier-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierTrichyId,
        payment_date: '2026-11-23',
        amount: 1000.0,
        payment_mode: 'bank_transfer',
        reference_number: 'NEFT-TRICHY-001',
        allocations: [
          {
            purchase_bill_id: benchmarkPurchaseBillId,
            allocated_amount: 1000.0,
          },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.match(body.data.payment_number, /^SPAY-\d{4}-\d{4}$/);
    assert.equal(Number(body.data.amount), 1000);
    assert.equal(Number(body.data.allocated_amount), 1000);
    assert.equal(Number(body.data.unallocated_amount), 0);
    payment1Id = body.data.id;

    // Verify bill balance is reduced to ₹1,835
    const billCheck = await query(
      `SELECT * FROM v_purchase_bill_balances WHERE purchase_bill_id = $1`,
      [benchmarkPurchaseBillId]
    );
    assert.equal(Number(billCheck.rows[0].outstanding_balance), 1835);
    assert.equal(billCheck.rows[0].payment_status, 'partially_paid');

    // Verify auto-posted accounting journal entry: DR 2100 (1000), CR 1120 (1000)
    const journalRes = await query(
      `SELECT je.*, jel.account_id, coa.account_code, jel.debit_amount, jel.credit_amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       WHERE je.source_type = 'SUPPLIER_PAYMENT' AND je.source_id = $1
       ORDER BY coa.account_code`,
      [payment1Id]
    );
    assert.equal(journalRes.rows.length, 2);
    const bankLine = journalRes.rows.find((r) => r.account_code === '1120');
    const apLine = journalRes.rows.find((r) => r.account_code === '2100');
    assert.ok(bankLine && apLine);
    assert.equal(Number(apLine.debit_amount), 1000);
    assert.equal(Number(bankLine.credit_amount), 1000);
  });

  await t.test('1.3. Should record unallocated supplier advance payment', async () => {
    const res = await fetch(`${baseUrl}/api/v1/supplier-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierTrichyId,
        payment_date: '2026-11-23',
        amount: 600.0,
        payment_mode: 'bank_transfer',
        reference_number: 'NEFT-TRICHY-002',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(Number(body.data.amount), 600);
    assert.equal(Number(body.data.unallocated_amount), 600);
    payment2Id = body.data.id;

    // Check supplier outstanding view shows advance
    const supplierCheck = await query(
      `SELECT * FROM v_supplier_outstanding WHERE supplier_id = $1`,
      [supplierTrichyId]
    );
    assert.equal(Number(supplierCheck.rows[0].unallocated_advances), 600);
    assert.equal(Number(supplierCheck.rows[0].net_payable_balance), 1235); // 1835 - 600
  });

  await t.test('1.4. Should allocate portion of advance payment to open purchase bill', async () => {
    const res = await fetch(`${baseUrl}/api/v1/supplier-payments/${payment2Id}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        purchase_bill_id: benchmarkPurchaseBillId,
        allocated_amount: 400.0,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(Number(body.data.allocated_amount), 400);
    assert.equal(Number(body.data.unallocated_amount), 200);

    // Bill outstanding balance drops from 1835 to 1435
    const billCheck = await query(
      `SELECT * FROM v_purchase_bill_balances WHERE purchase_bill_id = $1`,
      [benchmarkPurchaseBillId]
    );
    assert.equal(Number(billCheck.rows[0].outstanding_balance), 1435);
  });

  await t.test('1.5. Should reject over-allocation exceeding remaining bill balance or advance', async () => {
    // Attempting to allocate 300 when only 200 unallocated remains
    const res = await fetch(`${baseUrl}/api/v1/supplier-payments/${payment2Id}/allocate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        purchase_bill_id: benchmarkPurchaseBillId,
        allocated_amount: 300.0,
      }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('1.6. Should reverse supplier payment and restore bill balance atomically', async () => {
    const res = await fetch(`${baseUrl}/api/v1/supplier-payments/${payment1Id}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        reversal_reason: 'Duplicate payment processed in error by bank',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'reversed');

    // Verify bill balance restored by 1000 (from 1435 to 2435)
    const billCheck = await query(
      `SELECT * FROM v_purchase_bill_balances WHERE purchase_bill_id = $1`,
      [benchmarkPurchaseBillId]
    );
    assert.equal(Number(billCheck.rows[0].outstanding_balance), 2435);

    // Verify reversing accounting entry: DR 1120 (1000), CR 2100 (1000)
    const revJournalRes = await query(
      `SELECT je.*, coa.account_code, jel.debit_amount, jel.credit_amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       WHERE je.source_type = 'SUPPLIER_PAYMENT_REVERSAL' AND je.source_id = $1
       ORDER BY coa.account_code`,
      [payment1Id]
    );
    assert.equal(revJournalRes.rows.length, 2);
    const bankLine = revJournalRes.rows.find((r) => r.account_code === '1120');
    const apLine = revJournalRes.rows.find((r) => r.account_code === '2100');
    assert.equal(Number(bankLine.debit_amount), 1000);
    assert.equal(Number(apLine.credit_amount), 1000);

    // Cannot reverse an already reversed payment
    const reReverse = await fetch(`${baseUrl}/api/v1/supplier-payments/${payment1Id}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ reversal_reason: 'Trying again' }),
    });
    assert.equal(reReverse.status, 400);
  });

  // ============================================================================
  // MODULE 2: MULTI-WAREHOUSE MANAGEMENT & STOCK TRANSFERS
  // ============================================================================

  let coldWarehouseId;
  let transferId;

  await t.test('2.1. Should list seeded warehouses and create a new warehouse', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/warehouses`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.success, true);
    assert.ok(listBody.data.length >= 2);

    const createRes = await fetch(`${baseUrl}/api/v1/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        warehouse_code: 'WH-COLD',
        name: 'Madurai Cold Storage Depot',
        city: 'Madurai',
        state_code: '33',
        is_primary: false,
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    assert.equal(createBody.data.warehouse_code, 'WH-COLD');
    coldWarehouseId = createBody.data.id;
  });

  await t.test('2.2. Should query stock and valuation per warehouse', async () => {
    const stockRes = await fetch(`${baseUrl}/api/v1/warehouses/${primaryWarehouseId}/stock`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(stockRes.status, 200);
    const stockBody = await stockRes.json();
    assert.equal(stockBody.success, true);
    const murukkuStock = stockBody.data.find((item) => item.item_id === murukkuItemId);
    assert.ok(murukkuStock);
    assert.equal(Number(murukkuStock.current_stock_qty), 88);

    const valRes = await fetch(`${baseUrl}/api/v1/warehouses/${primaryWarehouseId}/valuation`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(valRes.status, 200);
    const valBody = await valRes.json();
    assert.equal(valBody.success, true);
    assert.ok(Number(valBody.data.total_warehouse_valuation) > 0);
  });

  await t.test('2.3. Should execute complete stock transfer workflow (request -> approve -> dispatch -> receive)', async () => {
    // 1. Create transfer request
    const reqRes = await fetch(`${baseUrl}/api/v1/warehouses/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        source_warehouse_id: primaryWarehouseId,
        destination_warehouse_id: secondaryWarehouseId,
        transfer_date: '2026-11-23',
        reason: 'Replenish Chennai distribution hub',
        items: [
          {
            item_id: murukkuItemId,
            requested_qty: 10.0,
            batch_number: 'BAT-MRK-20261119-01',
          },
        ],
      }),
    });
    assert.equal(reqRes.status, 201);
    const reqBody = await reqRes.json();
    assert.equal(reqBody.success, true);
    assert.equal(reqBody.data.status, 'draft');
    assert.match(reqBody.data.transfer_number, /^TRF-\d{4}-\d{4}$/);
    transferId = reqBody.data.id;

    // 2. Approve transfer
    const approveRes = await fetch(`${baseUrl}/api/v1/warehouses/transfers/${transferId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(approveRes.status, 200);
    const approveBody = await approveRes.json();
    assert.equal(approveBody.data.status, 'approved');

    // 3. Dispatch transfer
    const dispatchRes = await fetch(`${baseUrl}/api/v1/warehouses/transfers/${transferId}/dispatch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(dispatchRes.status, 200);
    const dispatchBody = await dispatchRes.json();
    assert.equal(dispatchBody.data.status, 'in_transit');

    // Verify source warehouse stock decreased from 88 to 78
    const postDispatchStock = await query(
      `SELECT current_stock_qty FROM v_warehouse_stock WHERE warehouse_id = $1 AND item_id = $2`,
      [primaryWarehouseId, murukkuItemId]
    );
    assert.equal(Number(postDispatchStock.rows[0].current_stock_qty), 78);

    // 4. Receive transfer at destination warehouse
    const receiveRes = await fetch(`${baseUrl}/api/v1/warehouses/transfers/${transferId}/receive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        items: [
          {
            transfer_item_id: dispatchBody.data.items[0].id,
            received_qty: 10.0,
          },
        ],
      }),
    });
    assert.equal(receiveRes.status, 200);
    const receiveBody = await receiveRes.json();
    assert.equal(receiveBody.data.status, 'completed');

    // Verify destination warehouse stock increased to 10
    const destStock = await query(
      `SELECT current_stock_qty FROM v_warehouse_stock WHERE warehouse_id = $1 AND item_id = $2`,
      [secondaryWarehouseId, murukkuItemId]
    );
    assert.equal(Number(destStock.rows[0].current_stock_qty), 10);

    // Verify Zero Valuation Drift: transfer_out cost equals transfer_in cost
    const ledgerTransfers = await query(
      `SELECT movement_type, quantity, unit_cost, total_cost 
       FROM inventory_ledger 
       WHERE movement_type IN ('WAREHOUSE_TRANSFER_OUT', 'WAREHOUSE_TRANSFER_IN')
       ORDER BY movement_type DESC`
    );
    assert.equal(ledgerTransfers.rows.length, 2);
    const trfOut = ledgerTransfers.rows.find((r) => r.movement_type === 'WAREHOUSE_TRANSFER_OUT');
    const trfIn = ledgerTransfers.rows.find((r) => r.movement_type === 'WAREHOUSE_TRANSFER_IN');
    assert.equal(Number(trfOut.quantity), 10);
    assert.equal(Number(trfIn.quantity), 10);
    assert.equal(Number(trfOut.total_cost), Number(trfIn.total_cost));
  });

  await t.test('2.4. Should prevent transfer if requested stock exceeds source warehouse balance', async () => {
    const res = await fetch(`${baseUrl}/api/v1/warehouses/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        source_warehouse_id: primaryWarehouseId,
        destination_warehouse_id: secondaryWarehouseId,
        transfer_date: '2026-11-23',
        items: [
          {
            item_id: murukkuItemId,
            requested_qty: 9999.0, // Insufficient stock
          },
        ],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /insufficient/i);
  });

  // ============================================================================
  // MODULE 3: BATCH, LOT & EXPIRY TRACKING (FEFO)
  // ============================================================================

  await t.test('3.1. Should query batch stock, near-expiry and expired alerts', async () => {
    const batchRes = await fetch(`${baseUrl}/api/v1/batches`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(batchRes.status, 200);
    const batchBody = await batchRes.json();
    assert.equal(batchBody.success, true);
    assert.ok(batchBody.data.length >= 5);

    const nearExpiryRes = await fetch(`${baseUrl}/api/v1/batches/near-expiry`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(nearExpiryRes.status, 200);

    const expiredRes = await fetch(`${baseUrl}/api/v1/batches/expired`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(expiredRes.status, 200);
  });

  await t.test('3.2. Should recommend stock allocation following FEFO logic', async () => {
    const fefoRes = await fetch(`${baseUrl}/api/v1/batches/fefo/${flourItemId}?quantity=50`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(fefoRes.status, 200);
    const fefoBody = await fefoRes.json();
    assert.equal(fefoBody.success, true);
    assert.equal(fefoBody.data.item_id, flourItemId);
    assert.equal(Number(fefoBody.data.allocated_qty), 50);
    assert.equal(fefoBody.data.is_sufficient, true);
    assert.ok(fefoBody.data.batches.length > 0);

    // Exceeding available stock indicates insufficient
    const overFefoRes = await fetch(`${baseUrl}/api/v1/batches/fefo/${flourItemId}?quantity=9999`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(overFefoRes.status, 200);
    const overBody = await overFefoRes.json();
    assert.equal(overBody.data.is_sufficient, false);
    assert.ok(Number(overBody.data.shortfall_qty) > 0);
  });

  await t.test('3.3. Should generate complete end-to-end traceability report for benchmark finished good batch', async () => {
    const res = await fetch(`${baseUrl}/api/v1/batches/traceability/BAT-MRK-20261119-01`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.batch_number, 'BAT-MRK-20261119-01');
    assert.ok(body.data.production_run, 'Must include production run details');
    assert.equal(body.data.production_run.run_number, 'PR-2026-11-001');
    assert.ok(body.data.raw_material_batches.length >= 3, 'Must trace raw material batches consumed');
    assert.ok(body.data.dispatches.length >= 1, 'Must trace customer dispatch');
    assert.equal(body.data.dispatches[0].dispatch_number, 'DSP-20261120-0001');
  });

  // ============================================================================
  // MODULE 4: INVENTORY ADJUSTMENTS & STOCK WRITE-OFFS
  // ============================================================================

  let adjId;

  await t.test('4.1. Should query discrepancies and create draft stock adjustment', async () => {
    const discRes = await fetch(`${baseUrl}/api/v1/inventory/adjustments/discrepancies`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(discRes.status, 200);

    // Create adjustment for damaged finished goods: -5 units write-off
    const createRes = await fetch(`${baseUrl}/api/v1/inventory/adjustments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        item_id: murukkuItemId,
        adjustment_date: '2026-11-23',
        physical_count: 73.0,
        recorded_count: 78.0,
        discrepancy_quantity: -5.0,
        reason: 'Transit crush damage and packaging puncture write-off',
        adjustment_type: 'damage_write_off',
        warehouse_id: primaryWarehouseId,
        batch_number: 'BAT-MRK-20261119-01',
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    assert.equal(createBody.data.status, 'draft');
    assert.match(createBody.data.adjustment_number, /^ADJ-\d{4}-\d{4}$/);
    adjId = createBody.data.id;
  });

  await t.test('4.2. Should post stock adjustment and automatically create write-off journal entry', async () => {
    const postRes = await fetch(`${baseUrl}/api/v1/inventory/adjustments/${adjId}/post`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(postRes.status, 200);
    const postBody = await postRes.json();
    assert.equal(postBody.success, true);
    assert.equal(postBody.data.status, 'posted');
    assert.ok(Number(postBody.data.total_cost) > 0);

    // Verify stock balance decreased in item_stock_balances
    const stockCheck = await query(
      `SELECT current_base_qty FROM item_stock_balances WHERE item_id = $1`,
      [murukkuItemId]
    );
    assert.equal(Number(stockCheck.rows[0].current_base_qty), 83); // 88 - 5

    // Verify inventory ledger movement
    const ledgerCheck = await query(
      `SELECT * FROM inventory_ledger WHERE stock_adjustment_id = $1`,
      [adjId]
    );
    assert.equal(ledgerCheck.rows.length, 1);
    assert.equal(ledgerCheck.rows[0].movement_type, 'STOCK_ADJUSTMENT');
    assert.equal(Number(ledgerCheck.rows[0].quantity_change), -5);

    // Verify Accounting: DR 6450 (Inventory Write-Off & Stock Loss), CR 1330 (Finished Goods)
    const journalCheck = await query(
      `SELECT je.*, coa.account_code, jel.debit_amount, jel.credit_amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       WHERE je.source_type = 'STOCK_ADJUSTMENT' AND je.source_id = $1
       ORDER BY coa.account_code`,
      [adjId]
    );
    assert.equal(journalCheck.rows.length, 2);
    const invLine = journalCheck.rows.find((r) => r.account_code === '1330');
    const lossLine = journalCheck.rows.find((r) => r.account_code === '6450');
    assert.ok(invLine && lossLine);
    assert.ok(Number(lossLine.debit_amount) > 0);
    assert.equal(Number(lossLine.debit_amount), Number(invLine.credit_amount));

    // Tamper-proofing: cannot re-post
    const rePostRes = await fetch(`${baseUrl}/api/v1/inventory/adjustments/${adjId}/post`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(rePostRes.status, 400);
  });

  // ============================================================================
  // MODULE 5: EMPLOYEE & PAYROLL MANAGEMENT
  // ============================================================================

  let employeeId;
  let payrollRunId;

  await t.test('5.1. Should register and manage employee master records', async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/employees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        employee_code: 'EMP-101',
        full_name: 'Sundaravadivel Murugan',
        department: 'Production',
        designation: 'Senior Machine Operator',
        joining_date: '2026-01-15',
        base_salary: 28000.0,
        bank_account_number: '987654321098',
        bank_ifsc: 'SBIN0001234',
        pan_number: 'ABCDE1234F',
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    assert.equal(createBody.data.employee_code, 'EMP-101');
    employeeId = createBody.data.id;

    // Update employee designation
    const updateRes = await fetch(`${baseUrl}/api/v1/employees/${employeeId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        designation: 'Lead Production Specialist',
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateBody = await updateRes.json();
    assert.equal(updateBody.data.designation, 'Lead Production Specialist');
  });

  await t.test('5.2. Should generate monthly payroll run and enforce unique period constraint', async () => {
    const runRes = await fetch(`${baseUrl}/api/v1/payroll/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        payroll_period: '2026-11',
        run_date: '2026-11-23',
      }),
    });
    assert.equal(runRes.status, 201);
    const runBody = await runRes.json();
    assert.equal(runBody.success, true);
    assert.equal(runBody.data.status, 'draft');
    assert.equal(runBody.data.payroll_period, '2026-11');
    assert.equal(Number(runBody.data.total_net_salary), 28000);
    payrollRunId = runBody.data.id;

    // Duplicate payroll run rejected
    const dupRes = await fetch(`${baseUrl}/api/v1/payroll/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        payroll_period: '2026-11',
        run_date: '2026-11-23',
      }),
    });
    assert.equal(dupRes.status, 409);
  });

  await t.test('5.3. Should approve payroll run and post accrual journal entry (DR 6100, CR 2400)', async () => {
    const approveRes = await fetch(`${baseUrl}/api/v1/payroll/${payrollRunId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(approveRes.status, 200);
    const approveBody = await approveRes.json();
    assert.equal(approveBody.success, true);
    assert.equal(approveBody.data.status, 'approved');

    // Verify Accounting Entry: DR 6100 (Salaries Expense), CR 2400 (Salaries Payable)
    const journalCheck = await query(
      `SELECT je.*, coa.account_code, jel.debit_amount, jel.credit_amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       WHERE je.source_type = 'PAYROLL_RUN' AND je.source_id = $1
       ORDER BY coa.account_code`,
      [payrollRunId]
    );
    assert.equal(journalCheck.rows.length, 2);
    const expLine = journalCheck.rows.find((r) => r.account_code === '6100');
    const liabLine = journalCheck.rows.find((r) => r.account_code === '2400');
    assert.ok(expLine && liabLine);
    assert.equal(Number(expLine.debit_amount), 28000);
    assert.equal(Number(liabLine.credit_amount), 28000);
  });

  await t.test('5.4. Should disburse payroll payout and post settlement journal entry (DR 2400, CR 1120)', async () => {
    const payRes = await fetch(`${baseUrl}/api/v1/payroll/${payrollRunId}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        payment_mode: 'bank_transfer',
        reference_txn_id: 'CMS-PAYROLL-202611-001',
      }),
    });
    assert.equal(payRes.status, 200);
    const payBody = await payRes.json();
    assert.equal(payBody.success, true);
    assert.equal(payBody.data.status, 'paid');

    // Verify Accounting Entry: DR 2400 (Salaries Payable), CR 1120 (Bank Operating)
    const journalCheck = await query(
      `SELECT je.*, coa.account_code, jel.debit_amount, jel.credit_amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       WHERE je.source_type = 'PAYROLL_PAYMENT' AND je.source_id = $1
       ORDER BY coa.account_code`,
      [payrollRunId]
    );
    assert.equal(journalCheck.rows.length, 2);
    const liabLine = journalCheck.rows.find((r) => r.account_code === '2400');
    const bankLine = journalCheck.rows.find((r) => r.account_code === '1120');
    assert.ok(liabLine && bankLine);
    assert.equal(Number(liabLine.debit_amount), 28000);
    assert.equal(Number(bankLine.credit_amount), 28000);
  });

  // ============================================================================
  // MODULE 6: ROLE-BASED ACCESS CONTROL (RBAC)
  // ============================================================================

  await t.test('6.1. Salesman cannot manage warehouses, post adjustments, or disburse payroll (403)', async () => {
    // Attempt to create warehouse
    const whRes = await fetch(`${baseUrl}/api/v1/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        warehouse_code: 'WH-SALES',
        name: 'Sales Depot',
      }),
    });
    assert.equal(whRes.status, 403);

    // Attempt to generate payroll
    const payRes = await fetch(`${baseUrl}/api/v1/payroll/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        payroll_period: '2026-12',
        run_date: '2026-12-01',
      }),
    });
    assert.equal(payRes.status, 403);

    // Attempt to record supplier payment
    const spayRes = await fetch(`${baseUrl}/api/v1/supplier-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        supplier_id: supplierTrichyId,
        amount: 500,
        payment_mode: 'cash',
        payment_date: '2026-11-23',
      }),
    });
    assert.equal(spayRes.status, 403);
  });

  await t.test('6.2. Auditor has read-only access to payables, transfers, batches, adjustments and payroll', async () => {
    // GET requests succeed (200)
    const payablesRes = await fetch(`${baseUrl}/api/v1/supplier-payments`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(payablesRes.status, 200);

    const whRes = await fetch(`${baseUrl}/api/v1/warehouses`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(whRes.status, 200);

    const trfRes = await fetch(`${baseUrl}/api/v1/warehouses/transfers`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(trfRes.status, 200);

    const adjRes = await fetch(`${baseUrl}/api/v1/inventory/adjustments`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(adjRes.status, 200);

    const payrollRes = await fetch(`${baseUrl}/api/v1/payroll`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(payrollRes.status, 200);

    // Mutating POST requests fail (403)
    const mutateWh = await fetch(`${baseUrl}/api/v1/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorToken}`,
      },
      body: JSON.stringify({ warehouse_code: 'WH-AUDIT', name: 'Audit Warehouse' }),
    });
    assert.equal(mutateWh.status, 403);
  });
});
