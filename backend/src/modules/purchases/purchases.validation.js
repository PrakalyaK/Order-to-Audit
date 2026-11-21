import { z } from 'zod';
import { ALL_PURCHASE_STATUSES } from './purchases.constants.js';

export const purchaseItemInputSchema = z.object({
  item_id: z.string({ required_error: 'Item ID is required' }).uuid('Item ID must be a valid UUID'),
  quantity: z
    .number({ required_error: 'Quantity is required' })
    .positive('Quantity must be greater than 0'),
  uom_id: z
    .string({ required_error: 'UOM ID is required' })
    .trim()
    .min(1, 'UOM ID cannot be empty')
    .max(10, 'UOM ID cannot exceed 10 characters')
    .toUpperCase(),
  unit_rate: z
    .number({ required_error: 'Unit rate is required' })
    .positive('Unit rate must be greater than 0'),
  supplier_batch_no: z
    .string()
    .trim()
    .max(50, 'Supplier batch number cannot exceed 50 characters')
    .optional()
    .nullable(),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
});

export const createPurchaseSchema = z.object({
  supplier_id: z
    .string({ required_error: 'Supplier ID is required' })
    .uuid('Supplier ID must be a valid UUID'),
  bill_number: z
    .string({ required_error: 'Bill number is required' })
    .trim()
    .min(1, 'Bill number cannot be empty')
    .max(50, 'Bill number cannot exceed 50 characters')
    .toUpperCase(),
  bill_date: z
    .string({ required_error: 'Bill date is required (YYYY-MM-DD)' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Bill date must be in YYYY-MM-DD format'),
  notes: z.string().trim().optional().nullable(),
  items: z
    .array(purchaseItemInputSchema)
    .min(1, 'At least one purchase item is required'),
});

export const updatePurchaseSchema = z.object({
  bill_number: z.string().trim().min(1).max(50).toUpperCase().optional(),
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().optional().nullable(),
  items: z.array(purchaseItemInputSchema).min(1).optional(),
});

export const queryPurchasesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(ALL_PURCHASE_STATUSES).optional(),
  supplier_id: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
