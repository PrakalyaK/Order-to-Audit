import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../backend/src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

const MIGRATION_FILES = [
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

async function setupDatabase(dropSchema = false) {
  const client = await pool.connect();
  try {
    console.log('='.repeat(70));
    console.log(`ORDER-TO-AUDIT: DATABASE SETUP & SEED [Reset: ${dropSchema}]`);
    console.log('='.repeat(70));

    if (dropSchema) {
      console.log('>>> Dropping and recreating public schema...');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;');
    }

    for (const relPath of MIGRATION_FILES) {
      const fullPath = path.resolve(PROJECT_ROOT, relPath);
      console.log(`>>> Applying ${relPath}...`);
      const sql = fs.readFileSync(fullPath, 'utf8');
      await client.query(sql);
      console.log(`✓ Applied ${relPath}`);
    }

    console.log('\n>>> All migrations and benchmark seed applied successfully!');

    const userCount = await client.query('SELECT count(*)::int as count FROM users');
    const invCount = await client.query('SELECT count(*)::int as count FROM invoices');
    const stockCount = await client.query('SELECT count(*)::int as count FROM stock_ledger');

    console.log(`\nVerification Summary:`);
    console.log(`- Seeded Users: ${userCount.rows[0].count}`);
    console.log(`- Seeded Invoices: ${invCount.rows[0].count}`);
    console.log(`- Inventory Movements: ${stockCount.rows[0].count}`);
    console.log('='.repeat(70));
  } catch (err) {
    console.error('DATABASE SETUP ERROR:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

const shouldReset = process.argv.includes('--reset') || process.argv.includes('-r');
setupDatabase(shouldReset);
