import { ApiError } from '../utils/ApiError.js';

/**
 * Role-Based Access Control Middleware (Phase 2 Foundation Stub)
 * Restricts access to specified roles: owner, factory_admin, production_supervisor, salesman, auditor.
 * 
 * @param  {...string} allowedRoles
 */
export const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  // To be implemented in Phase 2
  next();
};
