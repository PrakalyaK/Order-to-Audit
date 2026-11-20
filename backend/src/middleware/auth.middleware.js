import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { authRepository } from '../modules/auth/auth.repository.js';

/**
 * Authentication Middleware
 * Verifies JWT bearer token using explicit HS256 algorithm, validates user existence and active status in PostgreSQL,
 * and attaches sanitized user object to req.user.
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Authentication token is required');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw ApiError.unauthorized('Authentication token is required');
    }

    let decoded;
    try {
      // Explicitly require HS256 algorithm to prevent algorithm confusion attacks
      decoded = jwt.verify(token, env.jwt.secret, {
        algorithms: [env.jwt.algorithm || 'HS256'],
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Token has expired');
      }
      throw ApiError.unauthorized('Invalid authentication token');
    }

    // Always fetch fresh user state from repository rather than trusting token claims blindly
    const user = await authRepository.findById(decoded.sub);
    if (!user) {
      throw ApiError.unauthorized('User associated with token no longer exists');
    }

    if (!user.is_active) {
      throw ApiError.unauthorized('Account has been deactivated');
    }

    req.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      phone: user.phone,
      role: user.role,
      isActive: user.is_active,
    };

    next();
  } catch (err) {
    next(err);
  }
};
