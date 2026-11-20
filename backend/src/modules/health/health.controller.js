import { testConnection } from '../../config/db.js';
import { env } from '../../config/env.js';

/**
 * Health Check Controller
 * Verifies actual PostgreSQL database connectivity and reports server status.
 */
export const checkHealth = async (req, res) => {
  try {
    const dbStatus = await testConnection();

    return res.status(200).json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.nodeEnv,
      database: {
        status: 'connected',
        name: env.db.database,
        host: env.db.host,
        port: env.db.port,
        responseTimeMs: dbStatus.durationMs,
        serverTime: dbStatus.serverTime,
        version: dbStatus.pgVersion,
      },
    });
  } catch (error) {
    // Return HTTP 503 Service Unavailable if database is unreachable
    return res.status(503).json({
      success: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: env.nodeEnv,
      database: {
        status: 'disconnected',
        name: env.db.database,
        error: error.message || 'Unable to connect to PostgreSQL server',
      },
    });
  }
};
