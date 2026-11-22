import { query } from '../backend/src/config/db.js';

async function main() {
  const je = await query("SELECT COUNT(*) FROM journal_entries");
  console.log('Journal entries count:', je.rows[0].count);
  process.exit(0);
}
main().catch(console.error);
