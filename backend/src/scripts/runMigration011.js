import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClient } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const sqlPath = path.resolve(__dirname, '../../../database/migrations/011_advanced_erp_operations.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await getClient();
  try {
    console.log('>>> Applying Migration 011: Advanced ERP Operations...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('>>> Migration 011 applied successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('>>> Error applying Migration 011:', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

runMigration();
