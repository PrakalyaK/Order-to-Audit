import app from '../backend/src/app.js';
import { runAutoMigrations } from '../backend/src/scripts/autoMigrate.js';

let migrationRan = false;

export default async function handler(req, res) {
  // Automatically ensure database schema is active on first serverless invocation
  if (!migrationRan) {
    try {
      await runAutoMigrations();
      migrationRan = true;
    } catch (err) {
      console.warn('[VERCEL] Auto-migration check:', err.message);
      migrationRan = true;
    }
  }

  return app(req, res);
}
