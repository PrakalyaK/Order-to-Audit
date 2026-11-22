import { z } from 'zod';
import { VALID_DISPATCH_STATUSES } from './dispatches.constants.js';

const dispatchItemSchema = z.object({
  itemId: z.string().uuid('Invalid item UUID'),
  batchNumber: z.string().min(1, 'Batch number is required').max(50),
  dispatchedQty: z.number().positive('Dispatched quantity must be greater than zero'),
  uomId: z.string().min(1).max(10).optional(),
});

export const createDispatchSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice UUID'),
  dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dispatch date must be in YYYY-MM-DD format').optional(),
  carrierOrVehicleNo: z.string().max(50).optional().nullable(),
  driverName: z.string().max(100).optional().nullable(),
  items: z.array(dispatchItemSchema).min(1, 'Dispatch note must contain at least one item'),
});

export const queryDispatchesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(VALID_DISPATCH_STATUSES).optional(),
  invoiceId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const deliverDispatchSchema = z.object({
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional().nullable(),
});
