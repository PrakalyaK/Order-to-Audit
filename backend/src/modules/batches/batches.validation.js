import { z } from 'zod';

export const queryBatchesSchema = z.object({
  item_id: z.string().uuid().optional(),
  warehouse_id: z.string().uuid().optional(),
  is_expired: z.coerce.boolean().optional(),
  is_near_expiry: z.coerce.boolean().optional(),
});

export const fefoQuerySchema = z.object({
  quantity: z.coerce.number().positive('quantity must be strictly greater than 0'),
  warehouse_id: z.string().uuid().optional(),
});
