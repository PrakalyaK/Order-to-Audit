import { Router } from 'express';
import * as auditController from './audit.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

const AUDIT_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR];

router.get('/logs', authenticate, authorizeRoles(...AUDIT_ROLES), auditController.getLogs);
router.get('/filters', authenticate, authorizeRoles(...AUDIT_ROLES), auditController.getFilters);

export default router;
