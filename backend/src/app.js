import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import authRoutes from './modules/auth/auth.routes.js';
import itemsRoutes from './modules/items/items.routes.js';
import unitsRoutes from './modules/units/units.routes.js';
import partiesRoutes from './modules/parties/parties.routes.js';
import bomsRoutes from './modules/boms/boms.routes.js';
import purchasesRoutes from './modules/purchases/purchases.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import productionRoutes from './modules/production/production.routes.js';
import salesOrdersRoutes from './modules/sales-orders/sales-orders.routes.js';
import invoicesRoutes from './modules/invoices/invoices.routes.js';
import dispatchesRoutes from './modules/dispatches/dispatches.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import { notFoundHandler } from './middleware/notFound.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

const app = express();

// ============================================================================
// 1. GLOBAL SECURITY & UTILITY MIDDLEWARES
// ============================================================================

// HTTP header security
app.use(helmet());

// Cross-Origin Resource Sharing
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (env.corsOrigin.includes('*') || env.corsOrigin.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy does not allow access from origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// HTTP request logging
if (env.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================================
// 2. ROOT & HEALTH ROUTES
// ============================================================================

// Base API information endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Order-to-Audit Manufacturing API',
    version: '1.0.0',
    status: 'online',
    documentation: `${env.apiPrefix}/docs (Phase 10)`,
    healthCheck: `${env.apiPrefix}/health`,
  });
});

// Mount Routes
app.use(`${env.apiPrefix}/auth`, authRoutes);
app.use(`${env.apiPrefix}/items`, itemsRoutes);
app.use(`${env.apiPrefix}/units`, unitsRoutes);
app.use(`${env.apiPrefix}/parties`, partiesRoutes);
app.use(`${env.apiPrefix}/boms`, bomsRoutes);
app.use(`${env.apiPrefix}/purchases`, purchasesRoutes);
app.use(`${env.apiPrefix}/inventory`, inventoryRoutes);
app.use(`${env.apiPrefix}/production`, productionRoutes);
app.use(`${env.apiPrefix}/sales-orders`, salesOrdersRoutes);
app.use(`${env.apiPrefix}/invoices`, invoicesRoutes);
app.use(`${env.apiPrefix}/dispatches`, dispatchesRoutes);
app.use(`${env.apiPrefix}/health`, healthRoutes);
app.use('/health', healthRoutes);

// ============================================================================
// 3. ERROR HANDLING MIDDLEWARES
// ============================================================================

// 404 Handler for undefined routes
app.use(notFoundHandler);

// Centralized error handling
app.use(errorHandler);

export default app;
