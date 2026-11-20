import { Router } from 'express';
import * as unitsController from './units.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createUnitSchema, convertUnitSchema } from './units.validation.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

// Viewing units: all authenticated roles (owner, factory_admin, production_supervisor, salesman, auditor)
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.SALESMAN,
  ROLES.AUDITOR,
];

// Managing units: owner, factory_admin
const MANAGE_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN];

router.get('/', authenticate, authorizeRoles(...VIEW_ROLES), unitsController.getAll);
router.get('/:id', authenticate, authorizeRoles(...VIEW_ROLES), unitsController.getById);
router.post('/convert', authenticate, authorizeRoles(...VIEW_ROLES), validate(convertUnitSchema), unitsController.validateConversion);
router.post('/', authenticate, authorizeRoles(...MANAGE_ROLES), validate(createUnitSchema), unitsController.create);

export default router;
