import { Router } from 'express';
import * as fulfilmentController from './fulfilment.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, fulfilmentController.getNotifications);
router.patch('/mark-all-read', authenticate, fulfilmentController.markAllNotificationsRead);
router.patch('/:id/read', authenticate, fulfilmentController.markNotificationRead);

export default router;
