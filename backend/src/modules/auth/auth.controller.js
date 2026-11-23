import { asyncHandler } from '../../utils/asyncHandler.js';
import { authService } from './auth.service.js';
import { loginRateLimiter } from '../../middleware/rateLimiter.middleware.js';
import { env } from '../../config/env.js';

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = await authService.login(username, password);

  // Clear rate limiter upon successful authentication
  loginRateLimiter.reset();

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: result,
  });
});

export const demoLogin = asyncHandler(async (req, res) => {
  if (env.nodeEnv === 'production' && !env.enableDemoLogin) {
    return res.status(403).json({
      success: false,
      message: 'Demo login is disabled in production environment',
    });
  }

  const { username } = req.body;
  const result = await authService.demoLogin(username || 'owner_main');

  loginRateLimiter.reset();

  res.status(200).json({
    success: true,
    message: 'Demo login successful',
    data: result,
  });
});

export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
    },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user.id, currentPassword, newPassword);

  res.status(200).json({
    success: true,
    message: 'Password updated successfully',
  });
});
