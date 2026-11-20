/**
 * Development Password Setting Utility
 * 
 * Usage:
 *   node src/scripts/setPassword.js <username> <password>
 *   Or interactively:
 *   node src/scripts/setPassword.js
 * 
 * Securely hashes the password with bcryptjs and updates the user's password_hash in PostgreSQL.
 * Never outputs raw passwords or hashes.
 */
import readline from 'readline';
import bcrypt from 'bcryptjs';
import { authRepository } from '../modules/auth/auth.repository.js';
import { env } from '../config/env.js';
import { closePool } from '../config/db.js';

const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
};

async function main() {
  const args = process.argv.slice(2);
  let username = args[0];
  let password = args[1];

  try {
    if (!username) {
      username = await askQuestion('Enter username: ');
    }
    username = (username || '').trim();

    if (!username) {
      console.error('Error: Username cannot be empty.');
      process.exitCode = 1;
      return;
    }

    const user = await authRepository.findByUsername(username);
    if (!user) {
      console.error(`Error: User '${username}' does not exist in the database.`);
      process.exitCode = 1;
      return;
    }

    if (!password) {
      password = await askQuestion('Enter new password: ');
    }

    if (!password || password.length < 6) {
      console.error('Error: Password must be at least 6 characters long.');
      process.exitCode = 1;
      return;
    }

    console.log(`Hashing password with bcryptjs (salt rounds: ${env.bcrypt.saltRounds})...`);
    const hash = await bcrypt.hash(password, env.bcrypt.saltRounds);

    const updated = await authRepository.updatePasswordHash(user.id, hash);
    if (updated) {
      console.log(`[SUCCESS] Password updated successfully for user: ${updated.username} (Role: ${updated.role})`);
    } else {
      console.error('[ERROR] Failed to update password in database.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('[ERROR] An unexpected error occurred:', err.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
