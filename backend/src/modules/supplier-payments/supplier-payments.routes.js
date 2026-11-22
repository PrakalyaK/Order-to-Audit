import { Router } from 'express';
import * as controller from './supplier-payments.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createSupplierPaymentSchema,
  allocateSupplierPaymentSchema,
  reverseSupplierPaymentSchema,
  querySupplierPaymentsSchema,
} from './supplier-payments.validation.js';

const router = Router();

router.use(authenticate);

const VIEW_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR];
const OPS_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN];

// Payables analytics & reporting (Must precede `/:id`)
router.get(
  '/payables/summary',
  authorizeRoles(...VIEW_ROLES),
  controller.getPayablesSummary
);
router.get(
  '/summary',
  authorizeRoles(...VIEW_ROLES),
  controller.getPayablesSummary
);

router.get(
  '/payables/suppliers',
  authorizeRoles(...VIEW_ROLES),
  controller.getSupplierOutstanding
);
router.get(
  '/outstanding',
  authorizeRoles(...VIEW_ROLES),
  controller.getSupplierOutstanding
);

router.get(
  '/payables/bills',
  authorizeRoles(...VIEW_ROLES),
  controller.getPurchaseBillBalances
);
router.get(
  '/bills',
  authorizeRoles(...VIEW_ROLES),
  controller.getPurchaseBillBalances
);

// Payment CRUD & lifecycle
router.get(
  '/',
  authorizeRoles(...VIEW_ROLES),
  validate(querySupplierPaymentsSchema, 'query'),
  controller.getPayments
);

router.post(
  '/',
  authorizeRoles(...OPS_ROLES),
  validate(createSupplierPaymentSchema),
  controller.recordPayment
);

router.get(
  '/:id',
  authorizeRoles(...VIEW_ROLES),
  controller.getPaymentById
);

router.post(
  '/:id/allocate',
  authorizeRoles(...OPS_ROLES),
  validate(allocateSupplierPaymentSchema),
  controller.allocatePayment
);

router.post(
  '/:id/reverse',
  authorizeRoles(...OPS_ROLES),
  validate(reverseSupplierPaymentSchema),
  controller.reversePayment
);

export default router;
