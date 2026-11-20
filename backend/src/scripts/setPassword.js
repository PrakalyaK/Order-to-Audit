/**
 * Development Password Setting Utility
 * 
 * Usage:
 *   node src/scripts/setPassword.js [username]
 * 
 * Securely prompts for password with masked display (characters replaced with '*').
 * Passwords are NEVER accepted through command-line arguments to prevent leakage in shell history.
 * Hashes password using bcryptjs and updates PostgreSQL users table.
 */
import readline from 'readline';
import bcrypt from 'bcryptjs';
import { authRepository } from '../modules/auth/auth.repository.js';
import { env } from '../config/env.js';
import { closePool } from '../config/db.js';

/**
 * Prompts for password with masked input (echoes '*' instead of characters).
 * @param {string} promptText
 * @returns {Promise<string>}
 */
export const readMaskedPassword = (promptText = 'Enter new password (masked): ') => {
  return new Promise((resolve) => {
    process.stdout.write(promptText);

    // If stdin is not a TTY (e.g. piped input in non-interactive tests/scripts)
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        terminal: false,
      });
      rl.once('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
      return;
    }

    let password = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (chunk) => {
      for (const char of chunk) {
        // Enter key (\r or \n)
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(password);
        }
        // Ctrl+C (\u0003)
        if (char === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          process.exit(130);
        }
        // Backspace
        if (char === '\b' || char === '\x7f' || char === '\x08') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char.charCodeAt(0) >= 32) {
          password += char;
          process.stdout.write('*'); // Masked display
        }
      }
    };

    process.stdin.on('data', onData);
  });
};

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

  // Explicit safety requirement: Never accept passwords via CLI arguments
  if (args.length > 1) {
    console.warn(
      '[SECURITY WARNING] Password arguments are ignored. Passwords must be entered via masked interactive prompt only.'
    );
  }

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

    // Masked interactive password prompt (do not display while typing)
    const password = await readMaskedPassword('Enter new password (masked): ');

    if (!password || password.length < 12) {
      console.error('Error: Password must be at least 12 characters long.');
      process.exitCode = 1;
      return;
    }

    if (Buffer.byteLength(password, 'utf8') > 72) {
      console.error('Error: Password cannot exceed 72 bytes (bcrypt limitation).');
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

// Only execute when run directly
if (process.argv[1] && process.argv[1].endsWith('setPassword.js')) {
  main();
}
