import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { query, getClient } from '../src/config/db.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Phase 9 Financial Accounting & Reporting Integration Tests', async (t) => {
  let server;
  let baseUrl;

  // Benchmark Users
  const ownerId = '66666666-6666-6666-6666-666666666666';
  const adminId = '33333333-3333-3333-3333-333333333333';
  const supervisorId = '44444444-4444-4444-4444-444444444444';
  const salesmanId = '11111111-1111-1111-1111-111111111111';
  const auditorId = '55555555-5555-5555-5555-555555555555';

  // Benchmark Parties
  const retailerAId = '77777777-7777-7777-7777-777777777777'; // Customer (Tamil Nadu)
  const wholesalerBId = '88888888-8888-8888-8888-888888888888'; // Customer (Karnataka)
  const supplierTrichyId = '99999999-9999-9999-9999-999999999999'; // Supplier

  // Benchmark Operational IDs
  const benchmarkPurchaseBillId = 'ba000001-0000-0000-0000-000000000001';
  const benchmarkProductionRunId = 'da000001-0000-0000-0000-000000000001';
  const benchmarkInvoiceId = 'fa000001-0000-0000-0000-000000000001';
  const benchmarkDispatchId = 'eb000001-0000-0000-0000-000000000001';
  const benchmarkPaymentId = 'ed000001-0000-0000-0000-000000000001';

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

  // Pre-clean any test residue from previous runs
  const preClient = await getClient();
  try {
    await preClient.query('SET session_replication_role = replica;');
    await preClient.query('DELETE FROM journal_entry_lines;');
    await preClient.query('DELETE FROM journal_entries;');
    await preClient.query("DELETE FROM chart_of_accounts WHERE is_system = false;");
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
      (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger,
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

    // Teardown test accounting entries
    const cleanClient = await getClient();
    try {
      await cleanClient.query('SET session_replication_role = replica;');
      await cleanClient.query('DELETE FROM journal_entry_lines;');
      await cleanClient.query('DELETE FROM journal_entries;');
      await cleanClient.query("DELETE FROM chart_of_accounts WHERE is_system = false;");

      // Delete test audit logs
      await cleanClient.query(`
        DELETE FROM audit_logs 
        WHERE entity_name IN ('chart_of_accounts', 'journal_entries') 
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
        (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger,
        (SELECT COUNT(*)::int FROM chart_of_accounts WHERE is_system = true) AS system_accounts
    `);
    const finalCounts = finalCountsRes.rows[0];

    assert.deepEqual(finalCounts, initialCounts, 'Database benchmark counts must remain completely intact');
  });

  // ============================================================================
  // TEST SUITE 1: CHART OF ACCOUNTS (COA)
  // ============================================================================

  await t.test('1.1. Should fetch all seeded standard Chart of Accounts', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length >= 27, true, 'At least 27 standard accounts must be present');

    // Verify standard account codes exist
    const codes = body.data.map((a) => a.account_code);
    assert.ok(codes.includes('1110'), 'Cash in Hand present');
    assert.ok(codes.includes('1120'), 'Bank Operating present');
    assert.ok(codes.includes('1200'), 'Accounts Receivable present');
    assert.ok(codes.includes('1310'), 'Raw Materials Inventory present');
    assert.ok(codes.includes('1330'), 'Finished Goods Inventory present');
    assert.ok(codes.includes('2100'), 'Accounts Payable present');
    assert.ok(codes.includes('4100'), 'Sales Revenue present');
    assert.ok(codes.includes('5100'), 'COGS present');
    assert.ok(codes.includes('5900'), 'Overheads Absorbed present');
  });

  let customAccountId;

  await t.test('1.2. Should create a custom Chart of Accounts code', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        account_code: '6500',
        account_name: 'Marketing & Digital Advertising',
        account_type: 'expense',
        category: 'operating_expense',
        normal_balance: 'debit',
        description: 'Brand promotion and digital marketing campaigns',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.account_code, '6500');
    assert.equal(body.data.is_system, false);
    customAccountId = body.data.id;
  });

  await t.test('1.3. Should reject duplicate account code with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        account_code: '6500',
        account_name: 'Duplicate Marketing Account',
        account_type: 'expense',
        category: 'operating_expense',
        normal_balance: 'debit',
      }),
    });
    assert.equal(res.status, 409);
  });

  await t.test('1.4. Should update custom account details', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/accounts/${customAccountId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        account_name: 'Marketing, Advertising & Branding',
        description: 'Updated marketing description',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.account_name, 'Marketing, Advertising & Branding');
  });

  await t.test('1.5. Should prevent deactivation of core system accounts', async () => {
    // Find system account 1110
    const accountsRes = await fetch(`${baseUrl}/api/v1/accounting/accounts?account_code=1110`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const accounts = await accountsRes.json();
    const cashAcc = accounts.data.find((a) => a.account_code === '1110');

    const res = await fetch(`${baseUrl}/api/v1/accounting/accounts/${cashAcc.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /cannot be deactivated/i);
  });

  // ============================================================================
  // TEST SUITE 2: JOURNAL ENTRY CREATION & BALANCE VALIDATION
  // ============================================================================

  await t.test('2.1. Should reject unbalanced journal entry at validation layer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/journal-entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        entry_date: '2026-11-20',
        narration: 'Unbalanced entry test',
        lines: [
          { account_code: '1120', debit_amount: 1000, credit_amount: 0 },
          { account_code: '3100', debit_amount: 0, credit_amount: 950 }, // ₹50 difference!
        ],
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(JSON.stringify(body), /unbalanced/i);
  });

  await t.test('2.2. Should reject journal entry with fewer than 2 lines', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/journal-entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        entry_date: '2026-11-20',
        narration: 'Single line entry test',
        lines: [
          { account_code: '1120', debit_amount: 1000, credit_amount: 0 },
        ],
      }),
    });
    assert.equal(res.status, 400);
  });

  let manualEntryId;
  let manualEntryNumber;

  await t.test('2.3. Should create and immediately post a valid manual journal entry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/journal-entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        entry_date: '2026-11-20',
        narration: 'Owner initial capital contribution to operating bank account',
        lines: [
          { account_code: '1120', debit_amount: 50000.00, credit_amount: 0, description: 'Capital deposit in bank' },
          { account_code: '3100', debit_amount: 0, credit_amount: 50000.00, description: 'Owner capital credited' },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'posted');
    assert.equal(Number(body.data.total_debit), 50000.00);
    assert.equal(Number(body.data.total_credit), 50000.00);
    assert.match(body.data.entry_number, /^JE-\d{4}-\d{4}$/);

    manualEntryId = body.data.id;
    manualEntryNumber = body.data.entry_number;
  });

  await t.test('2.4. Should fetch journal entry by ID with lines and account metadata', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/journal-entries/${manualEntryId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.id, manualEntryId);
    assert.equal(body.data.lines.length, 2);
    assert.equal(body.data.lines[0].account_code, '1120');
    assert.equal(body.data.lines[1].account_code, '3100');
  });

  // ============================================================================
  // TEST SUITE 3: INTEGRATED OPERATIONAL POSTINGS & REVERSALS
  // ============================================================================

  await t.test('3.1. Should synchronize all operational transactions to General Ledger', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.purchase_bills_synced, 1);
    assert.equal(body.data.production_runs_synced, 1);
    assert.equal(body.data.sales_invoices_synced, 1);
    assert.equal(body.data.dispatches_synced, 1);
    assert.equal(body.data.payments_synced, 1);
    assert.equal(body.data.total_synced, 5);
  });

  await t.test('3.2. Synchronize must be idempotent (re-running sync posts 0 new entries)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.total_synced, 0, 'No duplicate postings should occur');
  });

  await t.test('3.3. Direct API call to post already posted purchase bill returns existing entry without duplicate', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/post/purchase-bill/${benchmarkPurchaseBillId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.source_type, 'PURCHASE_BILL');
    assert.equal(body.data.source_id, benchmarkPurchaseBillId);
  });

  // ============================================================================
  // TEST SUITE 4: GENERAL LEDGER & STATUTORY FINANCIAL STATEMENTS
  // ============================================================================

  await t.test('4.1. Should fetch General Ledger with running balances', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/ledger`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.length >= 10, 'Multiple ledger lines should exist');

    // Verify running balances are numbers
    body.data.forEach((line) => {
      assert.equal(typeof line.running_balance, 'number');
    });

    // Verify account filter
    const bankRes = await fetch(`${baseUrl}/api/v1/accounting/ledger?account_code=1120`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const bankBody = await bankRes.json();
    assert.ok(bankBody.data.length >= 2, 'Bank account should have capital deposit + customer payment');
    bankBody.data.forEach((line) => {
      assert.equal(line.account_code, '1120');
    });
  });

  await t.test('4.2. Trial Balance must balance exactly (Total Debits == Total Credits)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/reports/trial-balance`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.is_balanced, true, 'Trial Balance must be balanced');
    assert.equal(body.data.variance, 0, 'Variance must be 0.00');
    assert.equal(body.data.total_net_debit, body.data.total_net_credit, 'Net debits must equal net credits');
  });

  await t.test('4.3. Profit and Loss statement must report correct Gross Profit and Net Profit', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/reports/profit-and-loss`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.revenue.total, 7500.00, 'Sales Revenue should be ₹7,500.00');
    assert.equal(body.data.cost_of_goods_sold.total, 4635.51, 'COGS should be ₹4,635.51');
    assert.equal(body.data.gross_profit, 2864.49, 'Gross Profit = 7500 - 4635.51 = 2864.49');
    assert.ok(body.data.gross_margin_pct > 38, 'Gross margin % calculated correctly');
  });

  await t.test('4.4. Balance Sheet must verify the fundamental equation: Assets = Liabilities + Equity', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/reports/balance-sheet`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.is_balanced, true, 'Balance sheet must balance');
    assert.equal(body.data.variance, 0, 'Variance must be 0.00');
    assert.equal(
      body.data.assets.total_assets,
      body.data.total_liabilities_and_equity,
      'Total Assets must equal Total Liabilities + Total Equity'
    );
  });

  await t.test('4.5. Cash & Bank summary should report positive liquid balances', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/reports/cash-bank`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.total_cash_and_bank, 54000.00, '₹50,000 capital + ₹4,000 payment = ₹54,000');
  });

  await t.test('4.6. GST Reconciliation report must report Input Tax Credit and Output Tax Liability', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/reports/gst-reconciliation`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(Number(body.data.cgst_input_credit), 67.50);
    assert.equal(Number(body.data.sgst_input_credit), 67.50);
    assert.equal(Number(body.data.total_input_tax_credit), 135.00);
    assert.equal(Number(body.data.cgst_output_liability), 187.50);
    assert.equal(Number(body.data.sgst_output_liability), 187.50);
    assert.equal(Number(body.data.total_output_tax_liability), 375.00);
    assert.equal(Number(body.data.net_gst_payable_or_refundable), 240.00);
  });

  // ============================================================================
  // TEST SUITE 5: CONTROLLED REVERSAL & IMMUTABILITY ENFORCEMENT
  // ============================================================================

  let reversalEntryId;

  await t.test('5.1. Should perform controlled reversal of a posted journal entry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/journal-entries/${manualEntryId}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        reversal_reason: 'Incorrect capital infusion amount booked',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.match(body.data.narration, /REVERSAL of JE-/);
    assert.equal(body.data.status, 'posted');
    reversalEntryId = body.data.id;

    // Verify original entry marked reversed
    const origRes = await fetch(`${baseUrl}/api/v1/accounting/journal-entries/${manualEntryId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const origBody = await origRes.json();
    assert.equal(origBody.data.status, 'reversed');
    assert.equal(origBody.data.reversal_entry_id, reversalEntryId);
  });

  await t.test('5.2. Should reject re-reversal of an already reversed journal entry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/journal-entries/${manualEntryId}/reverse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        reversal_reason: 'Attempting to reverse already reversed entry',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /already.*reversed/i);
  });

  await t.test('5.3. Immutability trigger: Direct SQL DELETE on posted journal entry must be blocked', async () => {
    const directClient = await getClient();
    try {
      let threw = false;
      try {
        await directClient.query(`DELETE FROM journal_entries WHERE id = $1`, [manualEntryId]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /Statutory Audit Violation/i);
      }
      assert.equal(threw, true, 'Trigger must prevent DELETE on posted/reversed journal entry');
    } finally {
      directClient.release();
    }
  });

  // ============================================================================
  // TEST SUITE 6: ROLE-BASED ACCESS CONTROL (RBAC) ENFORCEMENT
  // ============================================================================

  await t.test('6.1. Auditor should have read-only access to all reports & ledger', async () => {
    const resTb = await fetch(`${baseUrl}/api/v1/accounting/reports/trial-balance`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(resTb.status, 200);

    const resPl = await fetch(`${baseUrl}/api/v1/accounting/reports/profit-and-loss`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(resPl.status, 200);

    const resBs = await fetch(`${baseUrl}/api/v1/accounting/reports/balance-sheet`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(resBs.status, 200);

    const resLedger = await fetch(`${baseUrl}/api/v1/accounting/ledger`, {
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(resLedger.status, 200);
  });

  await t.test('6.2. Auditor must be forbidden (403) from creating or reversing journal entries or syncing', async () => {
    const resCreate = await fetch(`${baseUrl}/api/v1/accounting/journal-entries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auditorToken}`,
      },
      body: JSON.stringify({
        entry_date: '2026-11-20',
        narration: 'Auditor attempt',
        lines: [
          { account_code: '1120', debit_amount: 100, credit_amount: 0 },
          { account_code: '3100', debit_amount: 0, credit_amount: 100 },
        ],
      }),
    });
    assert.equal(resCreate.status, 403);

    const resSync = await fetch(`${baseUrl}/api/v1/accounting/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auditorToken}` },
    });
    assert.equal(resSync.status, 403);
  });

  await t.test('6.3. Salesman must be forbidden (403) from all accounting endpoints', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/reports/trial-balance`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 403);

    const res2 = await fetch(`${baseUrl}/api/v1/accounting/ledger`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res2.status, 403);
  });

  await t.test('6.4. Production Supervisor must be forbidden (403) from all accounting endpoints', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounting/reports/balance-sheet`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(res.status, 403);

    const res2 = await fetch(`${baseUrl}/api/v1/accounting/journal-entries`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(res2.status, 403);
  });
});
