import { pool } from '../backend/src/config/db.js';

async function main() {
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM items) AS items,
      (SELECT COUNT(*) FROM boms) AS boms,
      (SELECT COUNT(*) FROM parties) AS parties,
      (SELECT COUNT(*) FROM purchase_bills) AS purchase_bills,
      (SELECT COUNT(*) FROM production_runs) AS production_runs,
      (SELECT COUNT(*) FROM sales_orders) AS sales_orders,
      (SELECT COUNT(*) FROM invoices) AS invoices,
      (SELECT COUNT(*) FROM dispatches) AS dispatches,
      (SELECT COUNT(*) FROM payments) AS payments,
      (SELECT COUNT(*) FROM payment_allocations) AS payment_allocations,
      (SELECT COUNT(*) FROM inventory_ledger) AS inventory_ledger,
      (SELECT COUNT(*) FROM warehouses) AS warehouses,
      (SELECT COUNT(*) FROM chart_of_accounts WHERE is_system = true) AS system_accounts
  `);
  console.log('BENCHMARK COUNTS:', counts.rows[0]);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
