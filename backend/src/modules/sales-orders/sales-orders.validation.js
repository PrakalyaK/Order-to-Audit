import { z } from 'zod';
import { VALID_SALES_ORDER_STATUSES } from './sales-orders.constants.js';

const salesOrderItemSchema = z.object({
  itemId: z.string().uuid('Invalid item UUID'),
  orderedQty: z.number().positive('Ordered quantity must be greater than zero'),
  uomId: z.string().min(1).max(10).optional(),
  unitPrice: z.number().nonnegative('Unit price cannot be negative').optional(),
});

export const createSalesOrderSchema = z.object({
  customerId: z.string().uuid('Invalid customer UUID'),
  salesmanId: z.string().uuid('Invalid salesman UUID').optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Order date must be in YYYY-MM-DD format').optional(),
  offlineClientUuid: z.string().uuid('Invalid offline client UUID').optional(),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(salesOrderItemSchema).min(1, 'Sales order must contain at least one item'),
});

export const updateSalesOrderSchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(salesOrderItemSchema).min(1, 'Sales order must contain at least one item').optional(),
});

const approveItemSchema = z.object({
  itemId: z.string().uuid('Invalid item UUID'),
  approvedQty: z.number().min(0, 'Approved quantity cannot be negative'),
});

export const approveSalesOrderSchema = z.object({
  items: z.array(approveItemSchema).optional(),
});

export const rejectSalesOrderSchema = z.object({
  rejectionReason: z.string().min(3, 'Rejection reason must be at least 3 characters long').max(500),
});

export const querySalesOrdersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(VALID_SALES_ORDER_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  salesmanId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
