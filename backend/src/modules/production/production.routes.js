import { Router } from 'express';
import * as productionController from './production.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createProductionRunSchema,
  issueMaterialsSchema,
  recordYieldAndCostingSchema,
  queryProductionRunsSchema,
} from './production.validation.js';

const router = Router();

// Protect all production routes with JWT authentication
router.use(authenticate);

// View roles: Owner, Factory Admin, Production Supervisor, Auditor (Salesman has NO access)
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.AUDITOR,
];

// Production operations roles: Owner, Factory Admin, Production Supervisor
const OPS_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
];

// Cancellation roles: Owner, Factory Admin
const CANCEL_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
];

// GET /api/v1/production - List production runs
router.get(
  '/',
  authorizeRoles(...VIEW_ROLES),
  validate(queryProductionRunsSchema, 'query'),
  productionController.getAll
);

// GET /api/v1/production/:id - Get production run details
router.get(
  '/:id',
  authorizeRoles(...VIEW_ROLES),
  productionController.getById
);

// GET /api/v1/production/:id/variance - Get mass balance & production variance
router.get(
  '/:id/variance',
  authorizeRoles(...VIEW_ROLES),
  productionController.getVariance
);

// GET /api/v1/production/:id/costing - Get batch costing
router.get(
  '/:id/costing',
  authorizeRoles(...VIEW_ROLES),
  productionController.getCosting
);

// POST /api/v1/production - Create draft production run
router.post(
  '/',
  authorizeRoles(...OPS_ROLES),
  validate(createProductionRunSchema),
  productionController.create
);

// POST /api/v1/production/:id/issue - Issue materials
router.post(
  '/:id/issue',
  authorizeRoles(...OPS_ROLES),
  validate(issueMaterialsSchema),
  productionController.issueMaterials
);

// POST /api/v1/production/:id/yield - Record output & post yield/costing
router.post(
  '/:id/yield',
  authorizeRoles(...OPS_ROLES),
  validate(recordYieldAndCostingSchema),
  productionController.recordYield
);

// POST /api/v1/production/:id/cancel - Cancel draft production run
router.post(
  '/:id/cancel',
  authorizeRoles(...CANCEL_ROLES),
  productionController.cancel
);

export default router;
