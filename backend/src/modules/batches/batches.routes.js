import { Router } from 'express';
import * as controller from './batches.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import { queryBatchesSchema, fefoQuerySchema } from './batches.validation.js';

const router = Router();

router.use(authenticate);

const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.PRODUCTION_SUPERVISOR,
  ROLES.AUDITOR,
  ROLES.SALESMAN,
];

router.get(
  '/',
  authorizeRoles(...VIEW_ROLES),
  validate(queryBatchesSchema, 'query'),
  controller.getBatches
);

router.get(
  '/stock',
  authorizeRoles(...VIEW_ROLES),
  validate(queryBatchesSchema, 'query'),
  controller.getBatches
);

router.get(
  '/near-expiry',
  authorizeRoles(...VIEW_ROLES),
  controller.getNearExpiry
);

router.get(
  '/expired',
  authorizeRoles(...VIEW_ROLES),
  controller.getExpired
);

router.get(
  '/fefo/:itemId',
  authorizeRoles(...VIEW_ROLES),
  validate(fefoQuerySchema, 'query'),
  controller.getFefo
);

router.post(
  '/allocate',
  authorizeRoles(...VIEW_ROLES),
  controller.postFefoAllocation
);

router.post(
  '/fefo',
  authorizeRoles(...VIEW_ROLES),
  controller.postFefoAllocation
);

router.get(
  '/traceability/:batchNumber',
  authorizeRoles(...VIEW_ROLES),
  controller.getTraceability
);

export default router;
