import { pool } from '../backend/src/config/db.js';
import bcrypt from '../backend/node_modules/bcryptjs/index.js';

async function main() {
  const users = await pool.query('SELECT username, password_hash FROM users');
  for (const u of users.rows) {
    console.log(`${u.username}: ${u.password_hash.substring(0, 15)}...`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
