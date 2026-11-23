import { query } from '../config/db.js';

async function main() {
  await query("DELETE FROM chart_of_accounts WHERE account_code = '6500'");
  await query("INSERT INTO chart_of_accounts (account_code, account_name, account_type, category, normal_balance, description, is_system) VALUES ('6450', 'Inventory Write-Off & Stock Loss', 'expense', 'operating_expense', 'debit', 'Losses from damaged, expired, or missing physical inventory', true) ON CONFLICT (account_code) DO NOTHING");
  console.log('COA adjusted successfully');
  process.exit(0);
}
main().catch(console.error);
