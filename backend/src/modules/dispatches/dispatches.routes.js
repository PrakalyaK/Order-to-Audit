import { Router } from 'express';
import * as dispatchesController from './dispatches.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createDispatchSchema,
  deliverDispatchSchema,
  queryDispatchesSchema,
} from './dispatches.validation.js';

const router = Router();

// Protect all dispatch routes with JWT authentication
router.use(authenticate);

// View roles: Owner, Factory Admin, Production Supervisor, Auditor
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.AUDITOR,
];

// Dispatch operations: Owner, Factory Admin, Production Supervisor
const DISPATCH_OPS_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
];

// Delivery & Costing roles
const ADMIN_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
];

const AUDIT_AND_ADMIN_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.AUDITOR,
];

// GET /api/v1/dispatches - List dispatches
router.get(
  '/',
  authorizeRoles(...VIEW_ROLES),
  validate(queryDispatchesSchema, 'query'),
  dispatchesController.getAll
);

// GET /api/v1/dispatches/:id - Get dispatch details
router.get(
  '/:id',
  authorizeRoles(...VIEW_ROLES),
  dispatchesController.getById
);

// GET /api/v1/dispatches/:id/cogs - Get COGS and Gross Margin calculation
router.get(
  '/:id/cogs',
  authorizeRoles(...AUDIT_AND_ADMIN_ROLES),
  dispatchesController.getCogs
);

// POST /api/v1/dispatches - Create dispatch note
router.post(
  '/',
  authorizeRoles(...DISPATCH_OPS_ROLES),
  validate(createDispatchSchema),
  dispatchesController.create
);

// POST /api/v1/dispatches/:id/post - Post dispatch to inventory ledger at Moving WAC
router.post(
  '/:id/post',
  authorizeRoles(...DISPATCH_OPS_ROLES),
  dispatchesController.postDispatch
);

// POST /api/v1/dispatches/:id/deliver - Confirm delivery
router.post(
  '/:id/deliver',
  authorizeRoles(...ADMIN_ROLES),
  validate(deliverDispatchSchema),
  dispatchesController.deliverDispatch
);

export default router;
