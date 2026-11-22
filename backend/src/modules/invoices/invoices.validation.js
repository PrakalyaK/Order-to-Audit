import { z } from 'zod';
import { VALID_INVOICE_STATUSES } from './invoices.constants.js';

export const createInvoiceSchema = z.object({
  salesOrderId: z.string().uuid('Invalid sales order UUID'),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invoice date must be in YYYY-MM-DD format').optional(),
  placeOfSupplyStateCode: z.string().length(2, 'Place of supply state code must be 2 digits').optional(),
  status: z.enum(['draft', 'posted']).default('posted').optional(),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});

export const queryInvoicesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(VALID_INVOICE_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  salesOrderId: z.string().uuid().optional(),
  financialYear: z.string().max(10).optional(),
  isInterstate: z.preprocess((val) => (val === 'true' ? true : val === 'false' ? false : val), z.boolean().optional()),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
