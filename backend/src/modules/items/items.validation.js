import { z } from 'zod';
import { ALL_ITEM_TYPES } from './items.constants.js';

export const createItemSchema = z.object({
  sku: z
    .string({ required_error: 'SKU is required' })
    .trim()
    .min(1, 'SKU cannot be empty')
    .max(50, 'SKU cannot exceed 50 characters')
    .toUpperCase(),
  name: z
    .string({ required_error: 'Item name is required' })
    .trim()
    .min(1, 'Item name cannot be empty')
    .max(150, 'Item name cannot exceed 150 characters'),
  item_type: z.enum(ALL_ITEM_TYPES, {
    required_error: `item_type is required and must be one of: ${ALL_ITEM_TYPES.join(', ')}`,
  }),
  base_uom_id: z
    .string({ required_error: 'Base UOM is required' })
    .trim()
    .min(1)
    .max(10)
    .toUpperCase(),
  hsn_code: z
    .string({ required_error: 'HSN code is required' })
    .trim()
    .min(2, 'HSN code must be at least 2 digits')
    .max(10, 'HSN code cannot exceed 10 characters'),
  gst_rate_pct: z
    .number()
    .min(0, 'GST rate cannot be negative')
    .max(28, 'GST rate cannot exceed 28%')
    .default(5.00),
  standard_selling_price: z
    .number()
    .min(0, 'Standard selling price cannot be negative')
    .default(0.00),
  standard_purchase_rate: z
    .number()
    .min(0, 'Standard purchase rate cannot be negative')
    .default(0.00),
  min_reorder_level: z
    .number()
    .min(0, 'Minimum reorder level cannot be negative')
    .default(0.0000),
  packets_per_carton: z
    .number()
    .positive('Packets per carton must be greater than 0')
    .default(1.00),
  is_active: z.boolean().default(true),
});

export const updateItemSchema = createItemSchema.partial();

export const setItemStatusSchema = z.object({
  is_active: z.boolean({ required_error: 'is_active boolean is required' }),
});

export const queryItemsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  item_type: z.enum(ALL_ITEM_TYPES).optional(),
  is_active: z.preprocess((val) => (val === 'true' ? true : val === 'false' ? false : val), z.boolean().optional()),
  base_uom_id: z.string().trim().toUpperCase().optional(),
});
