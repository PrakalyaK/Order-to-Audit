import { query } from '../backend/src/config/db.js';

async function main() {
  const tables = ['production_requirements', 'procurement_requirements', 'in_app_notifications'];
  for (const t of tables) {
    console.log(`\n=== TABLE: ${t} ===`);
    const cols = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `, [t]);
    console.table(cols.rows);

    const constraints = await query(`
      SELECT conname, pg_get_constraintdef(c.oid) as def
      FROM pg_constraint c
      JOIN pg_class cl ON c.conrelid = cl.oid
      WHERE cl.relname = $1;
    `, [t]);
    console.table(constraints.rows);
  }

  const soConstraints = await query(`
    SELECT conname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class cl ON c.conrelid = cl.oid
    WHERE cl.relname = 'sales_orders' AND conname LIKE '%status%';
  `);
  console.log('\n=== SALES_ORDERS STATUS CONSTRAINT ===');
  console.table(soConstraints.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
