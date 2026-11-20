/**
 * Wraps asynchronous Express route handlers to automatically catch
 * rejected promises and forward errors to the centralized error middleware.
 * 
 * @param {Function} fn - Async Express handler (req, res, next)
 * @returns {Function} Express middleware function
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
