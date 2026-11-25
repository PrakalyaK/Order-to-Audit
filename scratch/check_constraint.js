import { query } from '../backend/src/config/db.js';

async function main() {
  const res = await query(`
    SELECT conname, pg_get_constraintdef(c.oid) as def 
    FROM pg_constraint c
    JOIN pg_class cl ON c.conrelid = cl.oid
    WHERE cl.relname = 'production_requirements';
  `);
  console.log(res.rows);
  process.exit(0);
}

main();
