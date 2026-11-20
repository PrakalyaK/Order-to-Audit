import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { ZodError } from 'zod';

/**
 * Centralized Error Handling Middleware
 * Converts operational and system errors into clean, predictable JSON responses.
 * Never exposes raw PostgreSQL error details or stack traces to API clients in production.
 */
export const errorHandler = (err, req, res, next) => {
  let error = err;
  const isDev = env.nodeEnv === 'development';

  // 1. Handle Zod schema validation errors (preserve structured field errors across all environments)
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    error = ApiError.badRequest('Validation error occurred', formattedErrors);
  }

  // 2. Handle PostgreSQL specific constraint violations
  else if (err.code) {
    switch (err.code) {
      case '23505': // unique_violation
        error = new ApiError(
          409,
          isDev
            ? `Duplicate entry: ${err.detail || 'Record already exists'}`
            : 'A record with this unique identifier already exists.'
        );
        break;
      case '23503': // foreign_key_violation
        error = new ApiError(
          400,
          isDev
            ? `Referential integrity error: ${err.detail || 'Referenced record not found'}`
            : 'Referenced entity does not exist or cannot be removed.'
        );
        break;
      case '23514': // check_violation
        error = new ApiError(
          400,
          isDev
            ? `Database check constraint violated: ${err.message}`
            : 'Data value violates database integrity constraints.'
        );
        break;
      case 'P0001': // raise_exception (from PL/pgSQL business rules)
        error = new ApiError(400, err.message || 'Business rule constraint failure');
        break;
      case '08001':
      case '08006':
      case 'ECONNREFUSED':
        error = ApiError.serviceUnavailable('Database service is temporarily unavailable. Please try again later.');
        break;
      default:
        if (!error.statusCode) {
          error = ApiError.internal(
            isDev ? (err.message || 'Database error occurred') : 'An unexpected database error occurred.'
          );
        }
    }
  }

  // 3. Fallback for unknown runtime errors
  if (!(error instanceof ApiError)) {
    const statusCode = error.statusCode || 500;
    const message = isDev ? (error.message || 'An unexpected internal error occurred') : 'Internal server error';
    error = new ApiError(statusCode, message, [], false, err.stack);
  }

  // Log actual server-side errors (HTTP 5xx or unhandled system failures)
  if (error.statusCode >= 500) {
    console.error(`[SERVER ERROR] ${req.method} ${req.originalUrl}:`, {
      name: err.name,
      code: err.code,
      message: err.message,
      detail: err.detail,
      table: err.table,
      constraint: err.constraint,
      stack: err.stack,
    });
  }

  const response = {
    success: false,
    statusCode: error.statusCode,
    message: error.message,
    ...(error.errors && error.errors.length > 0 && { errors: error.errors }),
    ...(isDev && { stack: error.stack }),
  };

  res.status(error.statusCode).json(response);
};
