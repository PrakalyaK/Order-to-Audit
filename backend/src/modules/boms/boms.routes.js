import { Router } from 'express';
import * as bomsController from './boms.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import {
  createBomSchema,
  updateBomSchema,
  setBomStatusSchema,
  calculateRequirementsSchema,
  queryBomsSchema,
} from './boms.validation.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

// Viewing BOM: owner, factory_admin, production_supervisor, auditor (Salesman has NO access)
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.AUDITOR,
];

// Managing BOM: owner, factory_admin, production_supervisor
const MANAGE_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
];

router.get('/', authenticate, authorizeRoles(...VIEW_ROLES), validate(queryBomsSchema, 'query'), bomsController.getAll);
router.get('/:id', authenticate, authorizeRoles(...VIEW_ROLES), bomsController.getById);
router.post('/', authenticate, authorizeRoles(...MANAGE_ROLES), validate(createBomSchema), bomsController.create);
router.patch('/:id', authenticate, authorizeRoles(...MANAGE_ROLES), validate(updateBomSchema), bomsController.update);
router.patch('/:id/status', authenticate, authorizeRoles(...MANAGE_ROLES), validate(setBomStatusSchema), bomsController.setStatus);
router.post(
  '/:id/calculate-requirements',
  authenticate,
  authorizeRoles(...MANAGE_ROLES),
  validate(calculateRequirementsSchema),
  bomsController.calculateRequirements
);

export default router;
