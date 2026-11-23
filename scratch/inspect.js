import { query } from '../backend/src/config/db.js';

async function main() {
  const p = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'parties'");
  console.log('Parties columns:', p.rows.map(r => r.column_name));
  process.exit(0);
}
main().catch(console.error);
