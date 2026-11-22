import { z } from 'zod';
import { SUPPLIER_PAYMENT_MODES, SUPPLIER_PAYMENT_STATUS } from './supplier-payments.constants.js';

export const createSupplierPaymentSchema = z.object({
  supplier_id: z.string({ required_error: 'supplier_id is required' }).uuid('Invalid supplier_id UUID'),
  payment_date: z.string({ required_error: 'payment_date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be in YYYY-MM-DD format'),
  total_amount: z.coerce.number().positive('total_amount must be strictly greater than 0'),
  payment_mode: z.enum([
    SUPPLIER_PAYMENT_MODES.CASH,
    SUPPLIER_PAYMENT_MODES.UPI,
    SUPPLIER_PAYMENT_MODES.NEFT_RTGS,
    SUPPLIER_PAYMENT_MODES.BANK_TRANSFER,
    SUPPLIER_PAYMENT_MODES.CHEQUE,
    SUPPLIER_PAYMENT_MODES.LEGACY_RECONCILIATION,
  ]),
  reference_txn_id: z.string().trim().max(100).optional().nullable(),
  bank_name: z.string().trim().max(100).optional().nullable(),
  bank_branch: z.string().trim().max(100).optional().nullable(),
  cheque_number: z.string().trim().max(50).optional().nullable(),
  cheque_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  status: z.enum([SUPPLIER_PAYMENT_STATUS.DRAFT, SUPPLIER_PAYMENT_STATUS.POSTED]).default(SUPPLIER_PAYMENT_STATUS.POSTED),
  allocations: z.array(z.object({
    purchase_bill_id: z.string().uuid('Invalid purchase_bill_id UUID'),
    allocated_amount: z.coerce.number().positive('allocated_amount must be greater than 0'),
  })).optional().default([]),
});

export const allocateSupplierPaymentSchema = z.object({
  purchase_bill_id: z.string({ required_error: 'purchase_bill_id is required' }).uuid(),
  allocated_amount: z.coerce.number().positive('allocated_amount must be greater than 0'),
});

export const reverseSupplierPaymentSchema = z.object({
  reversal_reason: z.string({ required_error: 'reversal_reason is required' }).trim().min(3).max(500),
});

export const querySupplierPaymentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  supplier_id: z.string().uuid().optional(),
  status: z.string().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
