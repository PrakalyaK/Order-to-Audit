import bcrypt from '../backend/node_modules/bcryptjs/index.js';
import { query } from '../backend/src/config/db.js';

async function updatePasswords() {
  const hash = await bcrypt.hash('Password@123', 10);
  console.log('Generated bcrypt hash for Password@123:', hash);

  const res = await query(
    'UPDATE users SET password_hash = $1 WHERE username IN (\'owner_main\', \'admin_factory\', \'supervisor_floor\', \'salesman_a\', \'salesman_b\', \'auditor_ext\') RETURNING username, role',
    [hash]
  );

  console.log('Updated users:');
  for (const row of res.rows) {
    console.log(` - ${row.username} (${row.role}) -> Password@123`);
  }
  process.exit(0);
}

updatePasswords().catch(err => {
  console.error('Failed to update passwords:', err);
  process.exit(1);
});
