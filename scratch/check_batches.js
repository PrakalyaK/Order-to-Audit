import { query } from '../backend/src/config/db.js';

async function main() {
  const res = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'batches';
  `);
  console.log(res.rows);
  process.exit(0);
}

main();
