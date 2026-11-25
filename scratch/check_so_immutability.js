import { query } from '../backend/src/config/db.js';

async function main() {
  const res = await query(`
    SELECT pg_get_functiondef('fn_prevent_invoiced_or_dispatched_so_modification()'::regprocedure) as def;
  `);
  console.log(res.rows[0]?.def);
  process.exit(0);
}

main();
