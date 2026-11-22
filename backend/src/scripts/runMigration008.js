import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  try {
    const migrationPath = path.resolve(__dirname, '../../../database/migrations/008_sales_dispatch_invoicing_hardening.sql');
    console.log('Reading migration from:', migrationPath);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Executing Migration 008...');
    await query(sql);
    console.log('Migration 008 executed successfully!');

    const { rows } = await query(`
      SELECT trigger_name, event_object_table 
      FROM information_schema.triggers 
      WHERE trigger_name IN (
        'trg_prevent_invoiced_or_dispatched_so_modify',
        'trg_prevent_invoiced_or_dispatched_so_items_modify',
        'trg_prevent_posted_invoice_modify',
        'trg_prevent_posted_invoice_item_modify',
        'trg_prevent_dispatched_record_modify',
        'trg_prevent_dispatched_item_modify',
        'trg_audit_sales_orders',
        'trg_audit_sales_order_items',
        'trg_audit_invoice_items',
        'trg_audit_dispatches',
        'trg_audit_dispatch_items'
      )
      ORDER BY trigger_name;
    `);
    console.log(`Verified: ${rows.length} triggers installed.`);
    rows.forEach(r => console.log(` - ${r.trigger_name} on ${r.event_object_table}`));
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
