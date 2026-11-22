import { Router } from 'express';
import * as invoicesController from './invoices.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createInvoiceSchema,
  cancelInvoiceSchema,
  queryInvoicesSchema,
} from './invoices.validation.js';

const router = Router();

// Protect all invoice routes with JWT authentication
router.use(authenticate);

// View roles: Owner, Factory Admin, Auditor
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.AUDITOR,
];

// Invoicing operations: Owner, Factory Admin
const INVOICE_OPS_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
];

// Reports routes (Must precede `/:id`)
router.get(
  '/reports/gst-outward',
  authorizeRoles(...VIEW_ROLES),
  invoicesController.getGstOutwardReport
);

router.get(
  '/reports/customer-outstanding',
  authorizeRoles(...VIEW_ROLES),
  invoicesController.getCustomerOutstandingReport
);

router.get(
  '/reports/balances',
  authorizeRoles(...VIEW_ROLES),
  invoicesController.getBalancesReport
);

// GET /api/v1/invoices - List invoices
router.get(
  '/',
  authorizeRoles(...VIEW_ROLES),
  validate(queryInvoicesSchema, 'query'),
  invoicesController.getAll
);

// GET /api/v1/invoices/:id - Get invoice details
router.get(
  '/:id',
  authorizeRoles(...VIEW_ROLES),
  invoicesController.getById
);

// POST /api/v1/invoices - Generate tax invoice
router.post(
  '/',
  authorizeRoles(...INVOICE_OPS_ROLES),
  validate(createInvoiceSchema),
  invoicesController.create
);

// POST /api/v1/invoices/:id/cancel - Cancel invoice
router.post(
  '/:id/cancel',
  authorizeRoles(...INVOICE_OPS_ROLES),
  validate(cancelInvoiceSchema),
  invoicesController.cancel
);

export default router;
