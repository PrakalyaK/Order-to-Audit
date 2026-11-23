import { pool } from '../backend/src/config/db.js';

async function main() {
  const isb = await pool.query("SELECT * FROM item_stock_balances WHERE item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'");
  console.log('item_stock_balances for RM-FLOUR:', isb.rows[0]);

  const ledgerSum = await pool.query("SELECT SUM(base_quantity_delta) FROM inventory_ledger WHERE item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'");
  console.log('inventory_ledger total delta for RM-FLOUR:', ledgerSum.rows[0]);

  const batchSum = await pool.query("SELECT SUM(available_qty) FROM v_batch_stock WHERE item_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'");
  console.log('v_batch_stock total available_qty for RM-FLOUR:', batchSum.rows[0]);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
