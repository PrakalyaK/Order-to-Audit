import { Router } from 'express';
import * as paymentsController from './payments.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createPaymentSchema,
  updateDraftPaymentSchema,
  postPaymentSchema,
  allocatePaymentSchema,
  reversePaymentSchema,
  reverseAllocationSchema,
  queryPaymentsSchema,
  queryReceivablesSchema,
} from './payments.validation.js';

const router = Router();

// Protect all routes with JWT authentication
router.use(authenticate);

// RBAC Role Definitions
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.AUDITOR,
  ROLES.SALESMAN,
];

const PAYMENT_CREATE_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.SALESMAN,
];

const PAYMENT_OPS_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
];

// ============================================================================
// 1. RECEIVABLES & ANALYTICS REPORTS (Must precede `/:id`)
// ============================================================================

router.get(
  '/receivables/summary',
  authorizeRoles(...VIEW_ROLES),
  paymentsController.getReceivablesSummary
);

router.get(
  '/receivables/customers',
  authorizeRoles(...VIEW_ROLES),
  validate(queryReceivablesSchema, 'query'),
  paymentsController.getCustomerReceivables
);

router.get(
  '/receivables/invoices',
  authorizeRoles(...VIEW_ROLES),
  validate(queryReceivablesSchema, 'query'),
  paymentsController.getInvoiceBalances
);

router.get(
  '/customer/:customerId/history',
  authorizeRoles(...VIEW_ROLES),
  paymentsController.getCustomerHistory
);

router.get(
  '/invoice/:invoiceId/history',
  authorizeRoles(...VIEW_ROLES),
  paymentsController.getInvoiceHistory
);

// Individual allocation reversal
router.post(
  '/allocations/:allocationId/reverse',
  authorizeRoles(...PAYMENT_OPS_ROLES),
  validate(reverseAllocationSchema),
  paymentsController.reverseAllocation
);

// ============================================================================
// 2. PAYMENT CRUD & LIFECYCLE
// ============================================================================

router.get(
  '/',
  authorizeRoles(...VIEW_ROLES),
  validate(queryPaymentsSchema, 'query'),
  paymentsController.getAll
);

router.post(
  '/',
  authorizeRoles(...PAYMENT_CREATE_ROLES),
  validate(createPaymentSchema),
  paymentsController.create
);

router.get(
  '/:id',
  authorizeRoles(...VIEW_ROLES),
  paymentsController.getById
);

router.patch(
  '/:id',
  authorizeRoles(...PAYMENT_CREATE_ROLES),
  validate(updateDraftPaymentSchema),
  paymentsController.updateDraft
);

router.post(
  '/:id/post',
  authorizeRoles(...PAYMENT_OPS_ROLES),
  validate(postPaymentSchema),
  paymentsController.postPayment
);

router.post(
  '/:id/cancel',
  authorizeRoles(...PAYMENT_CREATE_ROLES),
  paymentsController.cancelDraft
);

router.post(
  '/:id/allocate',
  authorizeRoles(...PAYMENT_OPS_ROLES),
  validate(allocatePaymentSchema),
  paymentsController.allocate
);

router.post(
  '/:id/reverse',
  authorizeRoles(...PAYMENT_OPS_ROLES),
  validate(reversePaymentSchema),
  paymentsController.reverse
);

export default router;
