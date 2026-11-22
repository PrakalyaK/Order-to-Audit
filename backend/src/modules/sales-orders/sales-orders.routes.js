import { Router } from 'express';
import * as salesOrdersController from './sales-orders.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createSalesOrderSchema,
  updateSalesOrderSchema,
  approveSalesOrderSchema,
  rejectSalesOrderSchema,
  querySalesOrdersSchema,
} from './sales-orders.validation.js';

const router = Router();

// Protect all sales order routes with JWT authentication
router.use(authenticate);

// View roles: Owner, Factory Admin, Salesman, Production Supervisor, Auditor
const ALL_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.SALESMAN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.AUDITOR,
];

// Order management roles (Create/Edit/Cancel)
const ORDER_CREATOR_ROLES = [
  ROLES.SALESMAN,
  ROLES.FACTORY_ADMIN,
  ROLES.OWNER,
];

// Approval / Rejection roles (Factory Admin, Owner)
const APPROVER_ROLES = [
  ROLES.FACTORY_ADMIN,
  ROLES.OWNER,
];

// GET /api/v1/sales-orders - List sales orders
router.get(
  '/',
  authorizeRoles(...ALL_ROLES),
  validate(querySalesOrdersSchema, 'query'),
  salesOrdersController.getAll
);

// GET /api/v1/sales-orders/:id - Get sales order details
router.get(
  '/:id',
  authorizeRoles(...ALL_ROLES),
  salesOrdersController.getById
);

// POST /api/v1/sales-orders - Submit new sales order
router.post(
  '/',
  authorizeRoles(...ORDER_CREATOR_ROLES),
  validate(createSalesOrderSchema),
  salesOrdersController.create
);

// PATCH /api/v1/sales-orders/:id - Update submitted sales order
router.patch(
  '/:id',
  authorizeRoles(...ORDER_CREATOR_ROLES),
  validate(updateSalesOrderSchema),
  salesOrdersController.update
);

// POST /api/v1/sales-orders/:id/approve - Approve sales order
router.post(
  '/:id/approve',
  authorizeRoles(...APPROVER_ROLES),
  validate(approveSalesOrderSchema),
  salesOrdersController.approve
);

// POST /api/v1/sales-orders/:id/reject - Reject sales order
router.post(
  '/:id/reject',
  authorizeRoles(...APPROVER_ROLES),
  validate(rejectSalesOrderSchema),
  salesOrdersController.reject
);

// POST /api/v1/sales-orders/:id/cancel - Cancel sales order
router.post(
  '/:id/cancel',
  authorizeRoles(...ORDER_CREATOR_ROLES),
  salesOrdersController.cancel
);

export default router;
