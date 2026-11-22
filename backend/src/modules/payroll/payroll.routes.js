import { Router } from 'express';
import * as controller from './payroll.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  generatePayrollSchema,
  payPayrollSchema,
} from './payroll.validation.js';

const ADMIN_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN];
const VIEW_ROLES = [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR];

// ============================================================================
// EMPLOYEES ROUTER
// ============================================================================

export const employeesRouter = Router();
employeesRouter.use(authenticate);

employeesRouter.get('/', authorizeRoles(...VIEW_ROLES), controller.getEmployees);
employeesRouter.post(
  '/',
  authorizeRoles(...ADMIN_ROLES),
  validate(createEmployeeSchema),
  controller.createEmployee
);
employeesRouter.get('/:id', authorizeRoles(...VIEW_ROLES), controller.getEmployeeById);
employeesRouter.patch(
  '/:id',
  authorizeRoles(...ADMIN_ROLES),
  validate(updateEmployeeSchema),
  controller.updateEmployee
);

// ============================================================================
// PAYROLL ROUTER
// ============================================================================

export const payrollRouter = Router();
payrollRouter.use(authenticate);

payrollRouter.get('/', authorizeRoles(...VIEW_ROLES), controller.getPayrollRuns);
payrollRouter.get('/runs', authorizeRoles(...VIEW_ROLES), controller.getPayrollRuns);

payrollRouter.post(
  '/generate',
  authorizeRoles(...ADMIN_ROLES),
  validate(generatePayrollSchema),
  controller.generatePayrollRun
);

payrollRouter.get('/:id', authorizeRoles(...VIEW_ROLES), controller.getPayrollRunById);
payrollRouter.get('/runs/:id', authorizeRoles(...VIEW_ROLES), controller.getPayrollRunById);

payrollRouter.post(
  '/:id/approve',
  authorizeRoles(...ADMIN_ROLES),
  controller.approvePayrollRun
);
payrollRouter.post(
  '/runs/:id/approve',
  authorizeRoles(...ADMIN_ROLES),
  controller.approvePayrollRun
);

payrollRouter.post(
  '/:id/pay',
  authorizeRoles(...ADMIN_ROLES),
  validate(payPayrollSchema),
  controller.payPayrollRun
);
payrollRouter.post(
  '/runs/:id/pay',
  authorizeRoles(...ADMIN_ROLES),
  validate(payPayrollSchema),
  controller.payPayrollRun
);

export default payrollRouter;
