import { ApiError } from '../utils/ApiError.js';

/**
 * 404 Not Found Middleware
 * Intercepts requests that do not match any registered route and generates an ApiError.
 */
export const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};
