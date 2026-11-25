import { query } from '../backend/src/config/db.js';

async function main() {
  const res = await query(`SELECT pg_get_viewdef('v_batch_stock', true) as def;`);
  console.log(res.rows[0]?.def);
  process.exit(0);
}

main();
