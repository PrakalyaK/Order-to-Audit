import { Router } from 'express';
import * as inventoryController from './inventory.controller.js';
import { authenticateJWT } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  queryStockSchema,
  queryLedgerSchema,
  checkAvailabilitySchema,
} from './inventory.validation.js';

const router = Router();

// Protect all inventory routes with JWT authentication
router.use(authenticateJWT);

// GET /api/v1/inventory/stock - List stock balances (all roles can view stock)
router.get(
  '/stock',
  authorizeRoles(
    ROLES.OWNER,
    ROLES.FACTORY_ADMIN,
    ROLES.PRODUCTION_SUPERVISOR,
    ROLES.AUDITOR,
    ROLES.SALESMAN
  ),
  validate(queryStockSchema, 'query'),
  inventoryController.getCurrentStock
);

// GET /api/v1/inventory/low-stock - List low stock alerts (Owner, Factory Admin, Supervisor, Auditor)
router.get(
  '/low-stock',
  authorizeRoles(
    ROLES.OWNER,
    ROLES.FACTORY_ADMIN,
    ROLES.PRODUCTION_SUPERVISOR,
    ROLES.AUDITOR
  ),
  inventoryController.getLowStock
);

// GET /api/v1/inventory/valuation - Inventory valuation summary (Owner, Factory Admin, Auditor)
router.get(
  '/valuation',
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR),
  inventoryController.getValuation
);

// GET /api/v1/inventory/ledger - Movement history / stock ledger (Owner, Factory Admin, Supervisor, Auditor)
router.get(
  '/ledger',
  authorizeRoles(
    ROLES.OWNER,
    ROLES.FACTORY_ADMIN,
    ROLES.PRODUCTION_SUPERVISOR,
    ROLES.AUDITOR
  ),
  validate(queryLedgerSchema, 'query'),
  inventoryController.getLedger
);

// POST /api/v1/inventory/availability - Check availability for bill of materials / production (Owner, Factory Admin, Supervisor, Auditor)
router.post(
  '/availability',
  authorizeRoles(
    ROLES.OWNER,
    ROLES.FACTORY_ADMIN,
    ROLES.PRODUCTION_SUPERVISOR,
    ROLES.AUDITOR
  ),
  validate(checkAvailabilitySchema),
  inventoryController.checkAvailability
);

// GET /api/v1/inventory/stock/:itemId - Stock balance for single item
router.get(
  '/stock/:itemId',
  authorizeRoles(
    ROLES.OWNER,
    ROLES.FACTORY_ADMIN,
    ROLES.PRODUCTION_SUPERVISOR,
    ROLES.AUDITOR,
    ROLES.SALESMAN
  ),
  inventoryController.getItemStock
);

export default router;

