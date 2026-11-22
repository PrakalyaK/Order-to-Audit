import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const migrationPath = path.resolve(__dirname, '../../../database/migrations/010_financial_accounting.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Running Migration 010...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration 010 executed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration 010 failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
