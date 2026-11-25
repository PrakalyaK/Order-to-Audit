import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root of project is 3 levels up from backend/src/scripts/
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

/**
 * Ordered list of migrations required for a fresh database setup
 */
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
  'database/migrations/012_sample_products_and_boms.sql',
  'database/migrations/013_order_fulfilment_and_production_requirements.sql',
];

/**
 * Runs auto-migration and seeding if database tables are not yet initialized.
 * Safe to run on every startup (idempotent inspection).
 */
export async function runAutoMigrations() {
  const client = await pool.connect();
  try {
    // Check if the primary users table exists
    const checkTable = await client.query(`
      SELECT 1 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'users'
    `);

    if (checkTable.rowCount === 0) {
      console.log('\n[AUTO-MIGRATE] Fresh database detected. Executing migrations and benchmark seed...');
      for (const relPath of MIGRATION_FILES) {
        const fullPath = path.resolve(PROJECT_ROOT, relPath);
        if (!fs.existsSync(fullPath)) {
          console.warn(`[AUTO-MIGRATE] Warning: Migration file not found at ${fullPath}`);
          continue;
        }
        console.log(`[AUTO-MIGRATE] Applying ${relPath}...`);
        const sql = fs.readFileSync(fullPath, 'utf8');
        await client.query(sql);
      }
      console.log('[AUTO-MIGRATE] Successfully initialized schema and seeded benchmark data.\n');

      // Auto-sync initial operational transactions into GL
      try {
        const { accountingService } = await import('../modules/accounting/accounting.service.js');
        await accountingService.syncOperationalTransactions('33333333-3333-3333-3333-333333333333');
        console.log('[AUTO-MIGRATE] Successfully synchronized General Ledger entries.\n');
      } catch (syncErr) {
        console.warn('[AUTO-MIGRATE] Notice: GL auto-sync on init completed with:', syncErr.message);
      }
    } else {
      // Check if users exist in the table
      const userCountRes = await client.query('SELECT count(*)::int as count FROM users');
      if (userCountRes.rows[0].count === 0) {
        console.log('\n[AUTO-MIGRATE] Empty database detected. Seeding benchmark data...');
        const seedPath = path.resolve(PROJECT_ROOT, 'database/seeds/benchmark_seed.sql');
        if (fs.existsSync(seedPath)) {
          const sql = fs.readFileSync(seedPath, 'utf8');
          await client.query(sql);
          console.log('[AUTO-MIGRATE] Successfully seeded benchmark data.\n');
        }
      } else {
        console.log('[AUTO-MIGRATE] Database schema verified and active.');
      }
    }
  } catch (err) {
    console.error('[AUTO-MIGRATE] Migration error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
