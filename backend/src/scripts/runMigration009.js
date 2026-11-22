import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const migrationPath = path.resolve(__dirname, '../../../database/migrations/009_payments_receivables_hardening.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Running Migration 009...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration 009 executed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration 009 failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
