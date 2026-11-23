import { accountingService } from '../backend/src/modules/accounting/accounting.service.js';
import { pool } from '../backend/src/config/db.js';

async function syncAndCheck() {
  try {
    console.log('>>> Syncing operational transactions to General Ledger...');
    const syncRes = await accountingService.syncOperationalTransactions('33333333-3333-3333-3333-333333333333');
    console.log('Sync Result:', syncRes);

    const client = await pool.connect();
    const tbRes = await client.query(`
      SELECT 
        COALESCE(SUM(debit_amount), 0.00) AS total_debits,
        COALESCE(SUM(credit_amount), 0.00) AS total_credits
      FROM journal_entry_lines;
    `);
    console.log('\nJournal Entry Lines Totals:', tbRes.rows[0]);

    const tb = await accountingService.getTrialBalance();
    console.log('\nTrial Balance Summary:');
    console.log(`- Total Debits:  ₹${tb.totals.total_debit}`);
    console.log(`- Total Credits: ₹${tb.totals.total_credit}`);
    console.log(`- Difference:    ₹${tb.totals.difference}`);
    console.log(`- Is Balanced:   ${tb.is_balanced}`);

    client.release();
  } catch (err) {
    console.error('Error syncing:', err);
  } finally {
    await pool.end();
  }
}

syncAndCheck();
