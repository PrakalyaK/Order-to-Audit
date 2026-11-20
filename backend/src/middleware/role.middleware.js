import { ApiError } from '../utils/ApiError.js';

/**
 * Role-Based Access Control Middleware
 * Restricts access to specified roles: owner, factory_admin, production_supervisor, salesman, auditor.
 * 
 * @param {...string} allowedRoles
 */
export const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Authentication required'));
  }

  if (!allowedRoles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to access this resource'));
  }

  next();
};
