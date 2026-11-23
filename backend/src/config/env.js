import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env from backend root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || typeof jwtSecret !== 'string' || Buffer.byteLength(jwtSecret, 'utf8') < 32) {
  throw new Error(
    'Configuration error: JWT_SECRET must be configured in environment variables and must have sufficient cryptographic strength (at least 32 bytes).'
  );
}

export const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  corsOrigin: process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) 
    : ['http://localhost:5000', 'http://localhost:5173', 'http://localhost:3000'],
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'order_to_audit',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10) || 5000,
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    algorithm: 'HS256',
  },
  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 10,
  },
  factoryStateCode: process.env.FACTORY_STATE_CODE || '33',
  enableDemoLogin: process.env.ENABLE_DEMO_LOGIN === 'true' || process.env.NODE_ENV !== 'production',
};
