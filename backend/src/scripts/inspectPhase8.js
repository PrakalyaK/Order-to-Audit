import { query, pool } from '../config/db.js';

async function main() {
  const pCols = await query(`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'payments' 
    ORDER BY ordinal_position;
  `);
  console.log('payments columns:', pCols.rows);

  const paCols = await query(`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'payment_allocations' 
    ORDER BY ordinal_position;
  `);
  console.log('payment_allocations columns:', paCols.rows);

  const cons = await query(`
    SELECT conname, contype, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid IN ('payments'::regclass, 'payment_allocations'::regclass);
  `);
  console.log('constraints:', cons.rows);

  const samplePayment = await query(`SELECT * FROM payments;`);
  console.log('sample payments in DB:', samplePayment.rows);

  const sampleAlloc = await query(`SELECT * FROM payment_allocations;`);
  console.log('sample allocations in DB:', sampleAlloc.rows);

  const trgs = await query(`
    SELECT tgname, relname 
    FROM pg_trigger 
    JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid 
    WHERE relname IN ('payments', 'payment_allocations') AND NOT tgisinternal;
  `);
  console.log('triggers:', trgs.rows);

  await pool.end();
}

main().catch(console.error);
