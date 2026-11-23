import { Router } from 'express';
import * as reportsController from './reports.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

const ALL_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.SALESMAN,
  ROLES.AUDITOR,
];

const OPS_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.AUDITOR,
];

const SALES_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.SALESMAN,
  ROLES.AUDITOR,
];

const FINANCIAL_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.AUDITOR,
];

router.get('/dashboard', authenticate, authorizeRoles(...ALL_ROLES), reportsController.getDashboard);
router.get('/sales', authenticate, authorizeRoles(...SALES_ROLES), reportsController.getSales);
router.get('/inventory', authenticate, authorizeRoles(...OPS_ROLES), reportsController.getInventory);
router.get('/production', authenticate, authorizeRoles(...OPS_ROLES), reportsController.getProduction);
router.get('/financial', authenticate, authorizeRoles(...FINANCIAL_ROLES), reportsController.getFinancial);
router.get('/traceability/:batchNumber', authenticate, authorizeRoles(...OPS_ROLES), reportsController.getTraceability);

export default router;
