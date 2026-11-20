import { z } from 'zod';

export const bomItemInputSchema = z.object({
  item_id: z.string({ required_error: 'Material item_id is required' }).uuid('Material item_id must be a valid UUID'),
  standard_qty: z
    .number({ required_error: 'standard_qty is required' })
    .positive('standard_qty must be greater than 0'),
  uom_id: z
    .string({ required_error: 'uom_id is required' })
    .trim()
    .min(1)
    .max(10)
    .toUpperCase(),
  scrap_allowance_pct: z
    .number()
    .min(0, 'Scrap allowance cannot be negative')
    .max(100, 'Scrap allowance cannot exceed 100%')
    .default(0.00),
});

export const createBomSchema = z.object({
  finished_good_item_id: z
    .string({ required_error: 'finished_good_item_id is required' })
    .uuid('finished_good_item_id must be a valid UUID'),
  bom_code: z
    .string({ required_error: 'bom_code is required' })
    .trim()
    .min(1, 'bom_code cannot be empty')
    .max(50, 'bom_code cannot exceed 50 characters')
    .toUpperCase(),
  version_number: z
    .number()
    .int('version_number must be an integer')
    .positive('version_number must be greater than 0')
    .default(1),
  standard_batch_size: z
    .number({ required_error: 'standard_batch_size is required' })
    .positive('standard_batch_size must be greater than 0'),
  batch_uom_id: z
    .string({ required_error: 'batch_uom_id is required' })
    .trim()
    .min(1)
    .max(10)
    .toUpperCase(),
  tolerance_variance_pct: z
    .number()
    .min(0, 'Tolerance variance cannot be negative')
    .max(50, 'Tolerance variance cannot exceed 50%')
    .default(3.00),
  is_active: z.boolean().default(false),
  effective_from: z
    .string({ required_error: 'effective_from date is required (YYYY-MM-DD)' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be in YYYY-MM-DD format'),
  effective_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_to must be in YYYY-MM-DD format')
    .nullable()
    .optional(),
  notes: z.string().trim().optional(),
  materials: z
    .array(bomItemInputSchema)
    .min(1, 'A BOM must have at least one material entry'),
});

export const updateBomSchema = z.object({
  bom_code: z.string().trim().min(1).max(50).toUpperCase().optional(),
  tolerance_variance_pct: z.number().min(0).max(50).optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().optional(),
  is_active: z.boolean().optional(),
  // Modifying materials or standard_batch_size is allowed only if NOT used in production
  standard_batch_size: z.number().positive().optional(),
  batch_uom_id: z.string().trim().min(1).max(10).toUpperCase().optional(),
  materials: z.array(bomItemInputSchema).min(1).optional(),
});

export const setBomStatusSchema = z.object({
  is_active: z.boolean({ required_error: 'is_active boolean is required' }),
});

export const calculateRequirementsSchema = z.object({
  requested_output_qty: z
    .number({ required_error: 'requested_output_qty is required' })
    .positive('requested_output_qty must be greater than 0'),
  output_uom_id: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .toUpperCase()
    .optional(),
});

export const queryBomsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  finished_good_item_id: z.string().uuid().optional(),
  is_active: z.preprocess((val) => (val === 'true' ? true : val === 'false' ? false : val), z.boolean().optional()),
});
