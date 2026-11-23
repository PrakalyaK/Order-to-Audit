import { pool } from '../backend/src/config/db.js';

async function main() {
  const rows = await pool.query("SELECT * FROM inventory_ledger WHERE item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' ORDER BY id");
  console.log('inventory_ledger rows for RM-FLOUR:');
  console.table(rows.rows.map(r => ({
    id: r.id,
    movement_type: r.movement_type,
    batch_number: r.batch_number,
    qty: r.transaction_qty,
    delta: r.base_quantity_delta,
    unit_cost: r.unit_cost,
    total_cost: r.total_cost,
    ref: r.source_reference_label
  })));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
