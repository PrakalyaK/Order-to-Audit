import { query } from '../backend/src/config/db.js';

async function main() {
  const res = await query(`
    SELECT pg_get_viewdef('v_sales_order_fulfilment', true) as def;
  `);
  console.log(res.rows[0]?.def);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
