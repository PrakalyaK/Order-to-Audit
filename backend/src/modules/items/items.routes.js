import { Router } from 'express';
import * as itemsController from './items.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { createItemSchema, updateItemSchema, setItemStatusSchema, queryItemsSchema } from './items.validation.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

// Viewing items: all authenticated roles
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.SALESMAN,
  ROLES.AUDITOR,
];

// Managing items: owner, factory_admin
const MANAGE_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN];

router.get('/', authenticate, authorizeRoles(...VIEW_ROLES), validate(queryItemsSchema, 'query'), itemsController.getAll);
router.get('/:id', authenticate, authorizeRoles(...VIEW_ROLES), itemsController.getById);
router.post('/', authenticate, authorizeRoles(...MANAGE_ROLES), validate(createItemSchema), itemsController.create);
router.patch('/:id', authenticate, authorizeRoles(...MANAGE_ROLES), validate(updateItemSchema), itemsController.update);
router.patch('/:id/status', authenticate, authorizeRoles(...MANAGE_ROLES), validate(setItemStatusSchema), itemsController.setStatus);

export default router;
