import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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
import paymentsRoutes from './modules/payments/payments.routes.js';
import accountingRoutes from './modules/accounting/accounting.routes.js';
import supplierPaymentsRoutes from './modules/supplier-payments/supplier-payments.routes.js';
import warehousesRoutes from './modules/warehouses/warehouses.routes.js';
import batchesRoutes from './modules/batches/batches.routes.js';
import payrollRoutes, { employeesRouter } from './modules/payroll/payroll.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import fulfilmentRoutes from './modules/fulfilment/fulfilment.routes.js';
import notificationsRoutes from './modules/fulfilment/notifications.routes.js';
import { notFoundHandler } from './middleware/notFound.middleware.js';
import { errorHandler } from './middleware/error.middleware.js';

const app = express();

// ============================================================================
// 1. GLOBAL SECURITY & UTILITY MIDDLEWARES
// ============================================================================

// HTTP header security
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: null, // Do not upgrade to HTTPS on local HTTP port 5000
      },
    },
    strictTransportSecurity: false, // Do not enforce HSTS on localhost
    crossOriginEmbedderPolicy: false,
  })
);

// Cross-Origin Resource Sharing
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      const isVercel = /\.vercel\.app$/.test(new URL(origin).hostname);
      if (
        env.corsOrigin.includes('*') ||
        env.corsOrigin.includes(origin) ||
        isLocalhost ||
        isVercel ||
        process.env.VERCEL
      ) {
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

// Base API information endpoint (serves React SPA for browser navigations, JSON API info for API clients)
app.get('/', (req, res, next) => {
  if (req.headers.accept && req.headers.accept.includes('text/html') && !req.headers.accept.startsWith('*/*') && fs.existsSync(frontendDist)) {
    return res.sendFile(path.join(frontendDist, 'index.html'));
  }
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
app.use(`${env.apiPrefix}/fulfilment`, fulfilmentRoutes);
app.use(`${env.apiPrefix}/notifications`, notificationsRoutes);
app.use(`${env.apiPrefix}/invoices`, invoicesRoutes);
app.use(`${env.apiPrefix}/dispatches`, dispatchesRoutes);
app.use(`${env.apiPrefix}/payments`, paymentsRoutes);
app.use(`${env.apiPrefix}/accounting`, accountingRoutes);
app.use(`${env.apiPrefix}/supplier-payments`, supplierPaymentsRoutes);
app.use(`${env.apiPrefix}/warehouses`, warehousesRoutes);
app.use(`${env.apiPrefix}/batches`, batchesRoutes);
app.use(`${env.apiPrefix}/employees`, employeesRouter);
app.use(`${env.apiPrefix}/payroll`, payrollRoutes);
app.use(`${env.apiPrefix}/audit`, auditRoutes);
app.use(`${env.apiPrefix}/reports`, reportsRoutes);
app.use(`${env.apiPrefix}/users`, usersRoutes);
app.use(`${env.apiPrefix}/health`, healthRoutes);
app.use('/health', healthRoutes);

// ============================================================================
// 3. FRONTEND PRODUCTION STATIC ASSETS & SPA ROUTING
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDist = path.resolve(__dirname, '../../frontend/dist');

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      return next();
    }
    // If request does not accept HTML (e.g. API clients hitting /), skip to 404
    if (!req.accepts('html')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// ============================================================================
// 4. ERROR HANDLING MIDDLEWARES
// ============================================================================

// 404 Handler for undefined routes
app.use(notFoundHandler);

// Centralized error handling
app.use(errorHandler);

export default app;
