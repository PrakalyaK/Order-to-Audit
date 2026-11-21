import { z } from 'zod';
import { ALL_ITEM_TYPES } from '../items/items.constants.js';

export const queryStockSchema = z.object({
  search: z.string().trim().optional(),
  item_type: z.enum(ALL_ITEM_TYPES).optional(),
  is_low_stock: z
    .preprocess((val) => (val === 'true' ? true : val === 'false' ? false : val), z.boolean().optional()),
});

export const queryLedgerSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  item_id: z.string().uuid().optional(),
  movement_type: z
    .enum([
      'OPENING_BALANCE',
      'PURCHASE_RECEIPT',
      'PRODUCTION_ISSUE',
      'PRODUCTION_YIELD',
      'SALES_DISPATCH',
      'SALES_RETURN',
      'STOCK_ADJUSTMENT',
    ])
    .optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const availabilityItemSchema = z.object({
  item_id: z.string({ required_error: 'item_id is required' }).uuid('item_id must be a valid UUID'),
  required_qty: z.number({ required_error: 'required_qty is required' }).positive('required_qty must be greater than 0'),
  uom_id: z.string({ required_error: 'uom_id is required' }).trim().min(1).max(10).toUpperCase(),
});

export const checkAvailabilitySchema = z.object({
  items: z.array(availabilityItemSchema).min(1, 'At least one item is required to check availability'),
});
