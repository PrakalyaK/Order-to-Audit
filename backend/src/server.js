import app from './app.js';
import { env } from './config/env.js';
import { testConnection, closePool } from './config/db.js';
import { runAutoMigrations } from './scripts/autoMigrate.js';

let server;

/**
 * Start the Order-to-Audit Backend Service
 */
const startServer = async () => {
  try {
    console.log('='.repeat(70));
    console.log('ORDER-TO-AUDIT SYSTEM — BACKEND INITIALIZATION');
    console.log('='.repeat(70));
    console.log(`Environment: ${env.nodeEnv}`);
    console.log(`Configured Port: ${env.port}`);
    console.log(`Database Target: ${env.db.database} on ${env.db.host}:${env.db.port}`);

    // Verify PostgreSQL connectivity before binding listener
    console.log('\n[1/3] Testing PostgreSQL connection pool...');
    try {
      const dbInfo = await testConnection();
      console.log(`[OK] Connected to PostgreSQL in ${dbInfo.durationMs}ms`);
      console.log(`     Server Time: ${dbInfo.serverTime}`);

      console.log('\n[2/3] Verifying database schema & migrations...');
      await runAutoMigrations();
    } catch (dbErr) {
      console.error(`[WARN] PostgreSQL initialization failed: ${dbErr.message}`);
      console.error('       The server will start, but database operations may fail until connectivity is restored.');
    }

    // Start Express HTTP server
    console.log('\n[3/3] Starting Express HTTP listener...');
    server = app.listen(env.port, () => {
      console.log(`[OK] Server listening on http://localhost:${env.port}`);
      console.log(`     Health check: http://localhost:${env.port}${env.apiPrefix}/health`);
      console.log('='.repeat(70));
    });
  } catch (error) {
    console.error('Fatal error during application startup:', error);
    process.exit(1);
  }
};

/**
 * Graceful Shutdown Handler
 * Closes HTTP listener and drains PostgreSQL connection pool
 */
const gracefulShutdown = async (signal) => {
  console.log(`\nReceived ${signal}. Initiating graceful shutdown...`);

  if (server) {
    server.close(async () => {
      console.log('HTTP server closed. No longer accepting connections.');
      try {
        await closePool();
        console.log('Graceful shutdown completed successfully. Exiting.');
        process.exit(0);
      } catch (err) {
        console.error('Error closing database pool during shutdown:', err);
        process.exit(1);
      }
    });

    // Force close if graceful termination hangs
    setTimeout(() => {
      console.error('Graceful shutdown timed out. Forcing process termination.');
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
};

// Process-level signal listeners
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Uncaught exception and unhandled rejection handlers
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED PROMISE REJECTION:', reason);
});

// Launch server
startServer();
