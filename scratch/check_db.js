import { query } from '../backend/src/config/db.js';

async function main() {
  const res = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;`);
  console.log('TABLES:', res.rows.map(r => r.table_name));

  const views = await query(`SELECT table_name FROM information_schema.views WHERE table_schema='public' ORDER BY table_name;`);
  console.log('VIEWS:', views.rows.map(r => r.table_name));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
