import { Router } from 'express';
import * as partiesController from './parties.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createPartySchema, updatePartySchema, setPartyStatusSchema, queryPartiesSchema } from './parties.validation.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

// Viewing parties: owner, factory_admin, salesman, auditor (Production supervisor has NO access)
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.SALESMAN,
  ROLES.AUDITOR,
];

// Managing parties: owner, factory_admin
const MANAGE_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN];

router.get('/', authenticate, authorizeRoles(...VIEW_ROLES), validate(queryPartiesSchema, 'query'), partiesController.getAll);
router.get('/:id', authenticate, authorizeRoles(...VIEW_ROLES), partiesController.getById);
router.post('/', authenticate, authorizeRoles(...MANAGE_ROLES), validate(createPartySchema), partiesController.create);
router.patch('/:id', authenticate, authorizeRoles(...MANAGE_ROLES), validate(updatePartySchema), partiesController.update);
router.patch('/:id/status', authenticate, authorizeRoles(...MANAGE_ROLES), validate(setPartyStatusSchema), partiesController.setStatus);

export default router;
