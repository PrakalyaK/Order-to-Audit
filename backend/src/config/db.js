import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

const poolConfig = env.db.connectionString
  ? {
      connectionString: env.db.connectionString,
      ssl: env.db.ssl,
      max: env.db.max,
      idleTimeoutMillis: env.db.idleTimeoutMillis,
      connectionTimeoutMillis: env.db.connectionTimeoutMillis,
    }
  : {
      host: env.db.host,
      port: env.db.port,
      database: env.db.database,
      user: env.db.user,
      password: env.db.password,
      ssl: env.db.ssl,
      max: env.db.max,
      idleTimeoutMillis: env.db.idleTimeoutMillis,
      connectionTimeoutMillis: env.db.connectionTimeoutMillis,
    };

export const pool = new Pool(poolConfig);

// Prevent unhandled errors on idle clients from terminating the process
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Execute a parameterized SQL query against the connection pool
 * @param {string} text - SQL statement with $1, $2 parameter placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<pg.QueryResult>}
 */
export const query = (text, params) => pool.query(text, params);

/**
 * Acquire a dedicated client from the pool for multi-statement transactions
 * Remember to call client.release() in a finally block!
 * @returns {Promise<pg.PoolClient>}
 */
export const getClient = () => pool.connect();

/**
 * Test the active connection to the database and retrieve server metadata
 * @returns {Promise<{connected: boolean, serverTime: string, pgVersion: string, durationMs: number}>}
 */
export const testConnection = async () => {
  const start = Date.now();
  const res = await pool.query('SELECT NOW() AS server_time, version() AS pg_version');
  const duration = Date.now() - start;

  return {
    connected: true,
    serverTime: res.rows[0].server_time,
    pgVersion: res.rows[0].pg_version,
    durationMs: duration,
  };
};

/**
 * Close all pool connections gracefully during application shutdown
 */
export const closePool = async () => {
  if (pool.ending || pool.ended) {
    return;
  }
  console.log('Closing PostgreSQL connection pool...');
  await pool.end();
  console.log('PostgreSQL connection pool closed.');
};
