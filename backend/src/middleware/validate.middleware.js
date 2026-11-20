import { ApiError } from '../utils/ApiError.js';

/**
 * Zod Request Validation Middleware Factory
 * Validates req.body, req.query, or req.params against a Zod schema.
 * 
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @param {'body' | 'query' | 'params'} [source='body'] - Request segment to validate
 */
export const validate = (schema, source = 'body') => (req, res, next) => {
  try {
    const parsed = schema.parse(req[source]);
    req[source] = parsed;
    next();
  } catch (error) {
    next(error); // Caught by centralized errorHandler for ZodError formatting
  }
};
