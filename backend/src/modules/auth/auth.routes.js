import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { loginRateLimiter } from '../../middleware/rateLimiter.middleware.js';
import { loginSchema, changePasswordSchema } from './auth.validation.js';
import { ROLES } from './auth.constants.js';

const router = Router();

// Public authentication route protected by rate limiter
router.post('/login', loginRateLimiter, validate(loginSchema), authController.login);

// Authenticated user profile and password management
router.get('/me', authenticate, authController.getMe);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

// Role authorization verification endpoint
router.get(
  '/test-role-protected',
  authenticate,
  authorizeRoles(ROLES.OWNER, ROLES.FACTORY_ADMIN),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Authorized role access granted',
      user: {
        username: req.user.username,
        role: req.user.role,
      },
    });
  }
);

export default router;
