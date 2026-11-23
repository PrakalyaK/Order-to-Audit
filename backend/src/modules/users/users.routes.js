import { Router } from 'express';
import * as usersController from './users.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

// /me is accessible to any authenticated user
router.get('/me', authenticate, usersController.getMe);

// User list is accessible to Owner, Factory Admin, and Auditor
router.get(
  '/',
  authenticate,
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR),
  usersController.getUsers
);

router.get(
  '/:id',
  authenticate,
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN),
  usersController.getUserById
);

export default router;
