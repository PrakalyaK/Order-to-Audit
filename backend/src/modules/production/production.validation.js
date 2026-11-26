import { z } from 'zod';
import { PRODUCTION_STATUS, VALID_OVERHEAD_TYPES } from './production.constants.js';

export const productionInputItemSchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  planned_qty: z.number().positive('planned_qty must be greater than zero'),
  actual_issued_qty: z.number().positive('actual_issued_qty must be greater than zero'),
  good_production_qty: z.number().min(0, 'good_production_qty cannot be negative').optional(),
  damaged_or_scrap_qty: z.number().min(0, 'damaged_or_scrap_qty cannot be negative').optional(),
  returned_to_store_qty: z.number().min(0, 'returned_to_store_qty cannot be negative').optional(),
  uom_id: z.string().min(1, 'uom_id is required').max(10),
});

export const overheadItemSchema = z.object({
  overhead_type: z.enum(VALID_OVERHEAD_TYPES, {
    errorMap: () => ({
      message: `overhead_type must be one of: ${VALID_OVERHEAD_TYPES.join(', ')}`,
    }),
  }),
  description: z.string().max(150).optional(),
  amount: z.number().min(0, 'amount cannot be negative'),
});

export const createProductionRunSchema = z.object({
  bom_id: z.string().uuid('bom_id must be a valid UUID'),
  run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'run_date must be in YYYY-MM-DD format'),
  planned_batch_count: z.number().positive('planned_batch_count must be greater than zero').default(1.0),
  output_batch_number: z.string().min(1).max(50).optional(),
  notes: z.string().max(500).optional(),
  inputs: z.array(productionInputItemSchema).optional(),
});

export const issueMaterialsSchema = z.object({
  inputs: z.array(
    z.object({
      item_id: z.string().uuid('item_id must be a valid UUID'),
      actual_issued_qty: z.number().positive('actual_issued_qty must be greater than zero'),
      good_production_qty: z.number().min(0).optional(),
      damaged_or_scrap_qty: z.number().min(0).optional(),
      returned_to_store_qty: z.number().min(0).optional(),
      uom_id: z.string().min(1).max(10).optional(),
    })
  ).optional(),
});

export const actualConsumptionInputSchema = z.object({
  item_id: z.string().uuid('item_id must be a valid UUID'),
  actual_consumed_qty: z.number().min(0, 'actual_consumed_qty cannot be negative'),
  damaged_or_scrap_qty: z.number().min(0, 'damaged_or_scrap_qty cannot be negative').optional(),
  returned_to_store_qty: z.number().min(0, 'returned_to_store_qty cannot be negative').optional(),
});

export const recordYieldAndCostingSchema = z.object({
  actual_good_output_qty: z.number().positive('actual_good_output_qty must be greater than zero'),
  actual_scrap_output_qty: z.number().min(0, 'actual_scrap_output_qty cannot be negative').default(0),
  inputs: z.array(actualConsumptionInputSchema).optional(),
  overheads: z.array(overheadItemSchema).optional(),
});

export const queryProductionRunsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(Object.values(PRODUCTION_STATUS)).optional(),
  finished_good_item_id: z.string().uuid().optional(),
  bom_id: z.string().uuid().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
