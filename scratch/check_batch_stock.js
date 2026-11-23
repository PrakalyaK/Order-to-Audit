import { pool } from '../backend/src/config/db.js';

async function main() {
  const batchStock = await pool.query("SELECT * FROM v_batch_stock");
  console.log('Batch stock rows:');
  console.table(batchStock.rows);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
