import { Router } from 'express';
import * as fulfilmentController from './fulfilment.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { ROLES } from '../auth/auth.constants.js';

const router = Router();

const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.AUDITOR,
];

const OPS_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
];

const DISPATCH_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
];

// Fulfilment Dashboard & Orders
router.get('/', authenticate, authorizeRoles(...VIEW_ROLES), fulfilmentController.getDashboard);
router.get('/orders/:id', authenticate, authorizeRoles(...VIEW_ROLES), fulfilmentController.getOrderFulfilment);
router.post('/orders/:id/evaluate', authenticate, authorizeRoles(...OPS_ROLES), fulfilmentController.evaluateOrder);
router.post('/orders/:id/dispatch', authenticate, authorizeRoles(...DISPATCH_ROLES), fulfilmentController.dispatchOrder);

// Production Requirements
router.get('/production-requirements', authenticate, authorizeRoles(...VIEW_ROLES), fulfilmentController.getProductionRequirements);
router.get('/production-requirements/:id', authenticate, authorizeRoles(...VIEW_ROLES), fulfilmentController.getProductionRequirementDetails);
router.post('/production-requirements/:id/procure', authenticate, authorizeRoles(...OPS_ROLES), fulfilmentController.raiseProcurementRequirement);
router.post('/production-requirements/:id/initiate-production', authenticate, authorizeRoles(...OPS_ROLES), fulfilmentController.initiateProductionRun);

export default router;
