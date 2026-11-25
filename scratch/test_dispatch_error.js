import { fulfilmentService } from '../backend/src/modules/fulfilment/fulfilment.service.js';
import { query } from '../backend/src/config/db.js';

async function main() {
  const soRes = await query(`SELECT id FROM sales_orders WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1;`);
  const soId = soRes.rows[0]?.id;
  const adminUser = { id: '33333333-3333-3333-3333-333333333333', role: 'factory_admin' };
  const finishedGoodId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  try {
    const res = await fulfilmentService.dispatchFulfilmentOrder(
      soId,
      {
        carrierOrVehicleNo: 'TN-45-PARTIAL-01',
        driverName: 'Test Driver',
        items: [{ item_id: finishedGoodId, quantity: 5 }],
      },
      adminUser
    );
    console.log('Dispatch success:', res);
  } catch (err) {
    console.error('Dispatch error:', err.message, err);
  }
  process.exit(0);
}

main();
