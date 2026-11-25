import { query } from '../backend/src/config/db.js';

async function main() {
  const res = await query(`
    SELECT pg_get_functiondef('fn_post_sales_dispatch(uuid, uuid)'::regprocedure) as def;
  `);
  console.log(res.rows[0]?.def);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
