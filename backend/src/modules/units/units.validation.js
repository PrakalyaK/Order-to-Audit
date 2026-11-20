import { z } from 'zod';

export const createUnitSchema = z.object({
  id: z
    .string({ required_error: 'Unit ID / code is required' })
    .trim()
    .min(1, 'Unit ID cannot be empty')
    .max(10, 'Unit ID cannot exceed 10 characters')
    .toUpperCase(),
  name: z
    .string({ required_error: 'Unit name is required' })
    .trim()
    .min(1, 'Unit name cannot be empty')
    .max(50, 'Unit name cannot exceed 50 characters'),
  dimension: z.enum(['weight', 'volume', 'count', 'packaging'], {
    required_error: 'Dimension is required and must be weight, volume, count, or packaging',
  }),
  base_unit_id: z
    .string()
    .trim()
    .max(10)
    .toUpperCase()
    .nullable()
    .optional(),
  conversion_factor_to_base: z
    .number({ required_error: 'Conversion factor to base unit is required' })
    .positive('Conversion factor must be greater than 0')
    .default(1.0),
});

export const convertUnitSchema = z.object({
  itemId: z.string().uuid('Item ID must be a valid UUID'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  uomId: z.string().trim().min(1).max(10).toUpperCase(),
});
