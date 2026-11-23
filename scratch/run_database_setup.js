import fs from 'fs';
import path from 'path';
import { pool } from '../backend/src/config/db.js';

const ROOT_DIR = path.resolve('.');

async function run() {
  const client = await pool.connect();
  try {
    console.log('>>> Connected to PostgreSQL database.');

    // 1. Reset public schema
    console.log('>>> Dropping and recreating public schema...');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;');

    // 2. Ordered migration files as listed in database/setup.sql
    const migrations = [
      'database/migrations/001_initial_schema.sql',
      'database/migrations/002_constraints_and_indexes.sql',
      'database/migrations/003_audit_and_immutability.sql',
      'database/migrations/004_inventory_posting_engine.sql',
      'database/migrations/005_views.sql',
      'database/migrations/006_production_hardening_and_immutability.sql',
      'database/migrations/007_purchases_and_inventory_hardening.sql',
      'database/migrations/008_sales_dispatch_invoicing_hardening.sql',
      'database/migrations/009_payments_receivables_hardening.sql',
      'database/migrations/010_financial_accounting.sql',
      'database/migrations/011_advanced_erp_operations.sql',
      'database/seeds/benchmark_seed.sql',
    ];

    for (const relPath of migrations) {
      const fullPath = path.join(ROOT_DIR, relPath);
      console.log(`>>> Applying ${relPath}...`);
      const sql = fs.readFileSync(fullPath, 'utf8');
      await client.query(sql);
      console.log(`✓ Applied ${relPath}`);
    }

    console.log('\n>>> All migrations and benchmark seed applied successfully!');

    // Check users
    const usersRes = await client.query('SELECT username, role, is_active FROM users ORDER BY username;');
    console.log('\nSeeded users:');
    console.table(usersRes.rows);

    // Check invoice
    const invRes = await client.query('SELECT invoice_number, customer_name, total_invoice_value, total_paid_amount, outstanding_balance, derived_payment_status, invoice_status FROM v_invoice_balances;');
    console.log('\nSeeded invoices:');
    console.table(invRes.rows);

    // Check inventory
    const stockRes = await client.query('SELECT sku, item_name, closing_stock_base_qty, current_moving_wac, total_stock_valuation FROM v_current_stock ORDER BY sku;');
    console.log('\nSeeded stock balances:');
    console.table(stockRes.rows);

    // Check trial balance
    const tbRes = await client.query('SELECT account_code, account_name, net_debit_balance, net_credit_balance FROM v_trial_balance ORDER BY account_code;');
    console.log('\nTrial Balance:');
    console.table(tbRes.rows);

  } catch (err) {
    console.error('DATABASE SETUP ERROR:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
