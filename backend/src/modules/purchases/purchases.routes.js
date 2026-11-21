import { Router } from 'express';
import * as purchasesController from './purchases.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createPurchaseSchema,
  updatePurchaseSchema,
  queryPurchasesSchema,
} from './purchases.validation.js';

const router = Router();

// Protect all purchase routes with JWT authentication
router.use(authenticate);

// GET /api/v1/purchases - List purchases (Owner, Factory Admin, Auditor)
router.get(
  '/',
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR),
  validate(queryPurchasesSchema, 'query'),
  purchasesController.getAll
);

// GET /api/v1/purchases/:id - Get purchase details (Owner, Factory Admin, Auditor)
router.get(
  '/:id',
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR),
  purchasesController.getById
);

// POST /api/v1/purchases - Create purchase bill (Owner, Factory Admin)
router.post(
  '/',
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN),
  validate(createPurchaseSchema),
  purchasesController.create
);

// PATCH /api/v1/purchases/:id - Update draft purchase bill (Owner, Factory Admin)
router.patch(
  '/:id',
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN),
  validate(updatePurchaseSchema),
  purchasesController.update
);

// POST /api/v1/purchases/:id/receive - Post purchase receipt to inventory (Owner, Factory Admin)
router.post(
  '/:id/receive',
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN),
  purchasesController.receive
);

// POST /api/v1/purchases/:id/cancel - Cancel draft purchase bill (Owner, Factory Admin)
router.post(
  '/:id/cancel',
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN),
  purchasesController.cancel
);

export default router;
