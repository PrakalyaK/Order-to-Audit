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

// Statutory & Audit Registers
router.get('/sales-register', authenticate, authorizeRoles(...FINANCIAL_ROLES, ROLES.SALESMAN), reportsController.getSalesRegister);
router.get('/purchase-register', authenticate, authorizeRoles(...FINANCIAL_ROLES), reportsController.getPurchaseRegister);
router.get('/stock-summary', authenticate, authorizeRoles(...OPS_ROLES), reportsController.getStockSummary);
router.get('/stock-ledger', authenticate, authorizeRoles(...OPS_ROLES), reportsController.getStockLedger);
router.get('/production-yield-wastage', authenticate, authorizeRoles(...OPS_ROLES), reportsController.getYieldAndWastage);
router.get('/cost-per-packet', authenticate, authorizeRoles(...FINANCIAL_ROLES, ROLES.PRODUCTION_SUPERVISOR), reportsController.getCostPerPacket);
router.get('/receivables-ageing', authenticate, authorizeRoles(...FINANCIAL_ROLES, ROLES.SALESMAN), reportsController.getReceivablesAgeing);

export default router;
