import { pool } from '../config/db.js';

async function main() {
  const client = await pool.connect();
  try {
    const { rows: so } = await client.query(`SELECT id, order_number, status FROM sales_orders WHERE id = 'ea000001-0000-0000-0000-000000000001'`);
    console.log('Benchmark SO:', so[0]);

    try {
      await client.query(`UPDATE sales_orders SET status = 'submitted' WHERE id = 'ea000001-0000-0000-0000-000000000001'`);
      console.log('ERROR: UPDATE SUCCEEDED (TRIGGER DID NOT FIRE!)');
    } catch (err) {
      console.log('SUCCESS: Trigger fired and raised error:', err.message);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main();
