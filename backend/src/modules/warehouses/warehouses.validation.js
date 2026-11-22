import { z } from 'zod';
import { WAREHOUSE_STATUS } from './warehouses.constants.js';

export const createWarehouseSchema = z.object({
  warehouse_code: z
    .string({ required_error: 'warehouse_code is required' })
    .trim()
    .min(2, 'warehouse_code must be at least 2 characters')
    .max(20, 'warehouse_code cannot exceed 20 characters')
    .regex(/^[0-9A-Za-z_-]+$/, 'warehouse_code can only contain letters, numbers, hyphens, and underscores'),
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(2, 'name must be at least 2 characters')
    .max(100, 'name cannot exceed 100 characters'),
  address: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(50).optional().nullable(),
  state_code: z.string().trim().max(10).optional().nullable(),
  is_primary: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export const updateWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  address: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(50).optional().nullable(),
  state_code: z.string().trim().max(10).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const createTransferSchema = z.object({
  source_warehouse_id: z.string({ required_error: 'source_warehouse_id is required' }).uuid(),
  destination_warehouse_id: z.string({ required_error: 'destination_warehouse_id is required' }).uuid(),
  transfer_date: z.string({ required_error: 'transfer_date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
  items: z.array(z.object({
    item_id: z.string().uuid(),
    batch_number: z.string().trim().optional().nullable(),
    requested_qty: z.coerce.number().positive('requested_qty must be greater than 0'),
    uom_id: z.string().trim().min(1).optional().nullable(),
  })).min(1, 'Transfer must include at least one item'),
}).refine(
  (data) => data.source_warehouse_id !== data.destination_warehouse_id,
  { message: 'Source warehouse and destination warehouse cannot be the same', path: ['destination_warehouse_id'] }
);

export const receiveTransferSchema = z.object({
  items: z.array(z.object({
    transfer_item_id: z.string().uuid(),
    received_qty: z.coerce.number().min(0, 'received_qty must be non-negative'),
  })).min(1, 'Must provide at least one received item quantity'),
});

export const cancelTransferSchema = z.object({
  cancellation_reason: z.string({ required_error: 'cancellation_reason is required' }).trim().min(3).max(500),
});

export const queryTransfersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  source_warehouse_id: z.string().uuid().optional(),
  destination_warehouse_id: z.string().uuid().optional(),
});
