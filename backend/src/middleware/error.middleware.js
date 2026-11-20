import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { ZodError } from 'zod';

/**
 * Centralized Error Handling Middleware
 * Converts operational and system errors into clean, predictable JSON responses.
 */
export const errorHandler = (err, req, res, next) => {
  let error = err;

  // Handle Zod schema validation errors
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    error = ApiError.badRequest('Validation error occurred', formattedErrors);
  }

  // Handle PostgreSQL specific constraint violations
  else if (err.code) {
    switch (err.code) {
      case '23505': // unique_violation
        error = new ApiError(409, `Duplicate entry: ${err.detail || 'Record already exists'}`);
        break;
      case '23503': // foreign_key_violation
        error = new ApiError(400, `Referential integrity error: ${err.detail || 'Referenced record not found'}`);
        break;
      case '23514': // check_violation
        error = new ApiError(400, `Database check constraint violated: ${err.message}`);
        break;
      case 'P0001': // raise_exception (from PL/pgSQL business rules)
        error = new ApiError(400, err.message || 'Business rule constraint failure');
        break;
      case '08001':
      case '08006':
      case 'ECONNREFUSED':
        error = ApiError.serviceUnavailable('Database connection refused or unavailable');
        break;
      default:
        if (!error.statusCode) {
          error = ApiError.internal(err.message || 'Database error occurred');
        }
    }
  }

  // Fallback for unknown runtime errors
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'An unexpected internal error occurred';
    error = new ApiError(statusCode, message, [], false, err.stack);
  }

  const response = {
    success: false,
    statusCode: error.statusCode,
    message: error.message,
    ...(error.errors && error.errors.length > 0 && { errors: error.errors }),
    ...(env.nodeEnv === 'development' && { stack: error.stack }),
  };

  if (error.statusCode >= 500) {
    console.error(`[SERVER ERROR] ${req.method} ${req.originalUrl}:`, err);
  }

  res.status(error.statusCode).json(response);
};
