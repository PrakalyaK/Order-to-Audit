import { pool } from '../backend/src/config/db.js';

async function main() {
  const views = [
    'v_profit_and_loss',
    'v_trial_balance',
    'v_customer_outstanding',
    'v_supplier_outstanding',
    'v_production_variance',
    'v_cash_bank_summary'
  ];

  for (const v of views) {
    try {
      const res = await pool.query(`SELECT * FROM ${v} LIMIT 2`);
      console.log(`=== ${v} ===`, res.rows);
    } catch (e) {
      console.log(`=== ${v} ERROR ===`, e.message);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
