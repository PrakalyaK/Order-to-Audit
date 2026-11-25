import { fulfilmentService } from '../backend/src/modules/fulfilment/fulfilment.service.js';
import { query } from '../backend/src/config/db.js';

async function test() {
  const soRes = await query(`SELECT id FROM sales_orders WHERE status = 'approved' LIMIT 1;`);
  const soId = soRes.rows[0]?.id;
  console.log('Testing SO ID:', soId);
  try {
    const res = await fulfilmentService.getSalesOrderFulfilment(soId);
    console.log('Result:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

test();
