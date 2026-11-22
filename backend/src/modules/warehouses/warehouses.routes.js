import { Router } from 'express';
import * as controller from './warehouses.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  createTransferSchema,
  receiveTransferSchema,
  cancelTransferSchema,
  queryTransfersSchema,
} from './warehouses.validation.js';

const router = Router();

router.use(authenticate);

const VIEW_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR];
const OPS_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR];
const ADMIN_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN];

// ============================================================================
// 1. TRANSFERS (Must precede `/:id` parameterized warehouse routes)
// ============================================================================

router.get(
  '/transfers',
  authorizeRoles(...VIEW_ROLES),
  validate(queryTransfersSchema, 'query'),
  controller.getTransfers
);

router.post(
  '/transfers',
  authorizeRoles(...OPS_ROLES),
  validate(createTransferSchema),
  controller.createTransfer
);

router.get(
  '/transfers/:id',
  authorizeRoles(...VIEW_ROLES),
  controller.getTransferById
);

router.post(
  '/transfers/:id/approve',
  authorizeRoles(...ADMIN_ROLES),
  controller.approveTransfer
);

router.post(
  '/transfers/:id/dispatch',
  authorizeRoles(...OPS_ROLES),
  controller.dispatchTransfer
);

router.post(
  '/transfers/:id/receive',
  authorizeRoles(...OPS_ROLES),
  validate(receiveTransferSchema),
  controller.receiveTransfer
);

router.post(
  '/transfers/:id/cancel',
  authorizeRoles(...ADMIN_ROLES),
  validate(cancelTransferSchema),
  controller.cancelTransfer
);

// ============================================================================
// 2. WAREHOUSES CRUD & ANALYTICS
// ============================================================================

router.get(
  '/stock-valuation',
  authorizeRoles(...VIEW_ROLES),
  controller.getWarehouses
);

router.get(
  '/',
  authorizeRoles(...VIEW_ROLES),
  controller.getWarehouses
);

router.post(
  '/',
  authorizeRoles(...ADMIN_ROLES),
  validate(createWarehouseSchema),
  controller.createWarehouse
);

router.get(
  '/:id',
  authorizeRoles(...VIEW_ROLES),
  controller.getWarehouseById
);

router.patch(
  '/:id',
  authorizeRoles(...ADMIN_ROLES),
  validate(updateWarehouseSchema),
  controller.updateWarehouse
);

router.get(
  '/:id/stock',
  authorizeRoles(...VIEW_ROLES),
  controller.getWarehouseStock
);

router.get(
  '/:id/valuation',
  authorizeRoles(...VIEW_ROLES),
  controller.getWarehouseValuation
);

export default router;
