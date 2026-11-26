import app from '../backend/src/app.js';
import { runAutoMigrations } from '../backend/src/scripts/autoMigrate.js';

let migrationRan = false;

export default async function handler(req, res) {
  // Only execute schema auto-migrations if explicitly flagged via RUN_AUTO_MIGRATE=true
  // This keeps serverless cold-start latency minimal (<100ms) for deployed production traffic
  if (!migrationRan && process.env.RUN_AUTO_MIGRATE === 'true') {
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
