import { pool } from '../backend/src/config/db.js';

async function main() {
  const priCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'production_run_inputs'");
  console.log('production_run_inputs columns:', priCols.rows.map(r => r.column_name));

  const ilCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory_ledger'");
  console.log('inventory_ledger columns:', ilCols.rows.map(r => r.column_name));

  const sampleLedger = await pool.query("SELECT movement_type, batch_number, base_quantity_delta FROM inventory_ledger WHERE movement_type = 'PRODUCTION_ISSUE'");
  console.log('PRODUCTION_ISSUE ledger rows:', sampleLedger.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
