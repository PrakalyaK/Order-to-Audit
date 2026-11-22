import { z } from 'zod';
import { PAYMENT_STATUS, PAYMENT_MODES } from './payments.constants.js';

const paymentModeEnum = z.enum([
  PAYMENT_MODES.CASH,
  PAYMENT_MODES.UPI,
  PAYMENT_MODES.NEFT_RTGS,
  PAYMENT_MODES.BANK_TRANSFER,
  PAYMENT_MODES.CHEQUE,
  PAYMENT_MODES.LEGACY_RECONCILIATION,
]);

export const paymentAllocationItemSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice UUID'),
  amount: z.coerce.number().positive('Allocated amount must be positive'),
});

export const createPaymentSchema = z.object({
  customerId: z.string().uuid('Invalid customer UUID'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Payment date must be in YYYY-MM-DD format').optional(),
  totalAmount: z.coerce.number().positive('Total payment amount must be greater than 0'),
  paymentMode: paymentModeEnum,
  referenceTxnId: z.string().max(100).optional().nullable(),
  bankName: z.string().max(100).optional().nullable(),
  bankBranch: z.string().max(100).optional().nullable(),
  chequeNumber: z.string().max(50).optional().nullable(),
  chequeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Cheque date must be in YYYY-MM-DD format').optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum([PAYMENT_STATUS.DRAFT, PAYMENT_STATUS.POSTED]).default(PAYMENT_STATUS.POSTED).optional(),
  allocations: z.array(paymentAllocationItemSchema).optional(),
});

export const updateDraftPaymentSchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  totalAmount: z.coerce.number().positive().optional(),
  paymentMode: paymentModeEnum.optional(),
  referenceTxnId: z.string().max(100).optional().nullable(),
  bankName: z.string().max(100).optional().nullable(),
  bankBranch: z.string().max(100).optional().nullable(),
  chequeNumber: z.string().max(50).optional().nullable(),
  chequeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const postPaymentSchema = z.object({
  allocations: z.array(paymentAllocationItemSchema).optional(),
});

export const allocatePaymentSchema = z.union([
  // Single allocation format: { invoiceId, amount }
  paymentAllocationItemSchema,
  // Multi allocation format: { allocations: [{ invoiceId, amount }] }
  z.object({
    allocations: z.array(paymentAllocationItemSchema).min(1, 'At least one allocation must be provided'),
  }),
]);

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(3, 'Reversal reason must be at least 3 characters').max(500),
});

export const reverseAllocationSchema = z.object({
  reason: z.string().trim().min(3, 'Reversal reason must be at least 3 characters').max(500),
});

export const queryPaymentsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum([PAYMENT_STATUS.DRAFT, PAYMENT_STATUS.POSTED, PAYMENT_STATUS.CANCELLED, PAYMENT_STATUS.REVERSED]).optional(),
  customerId: z.string().uuid().optional(),
  paymentMode: paymentModeEnum.optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  receiptNumber: z.string().optional(),
});

export const queryReceivablesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  customerId: z.string().uuid().optional(),
  status: z.enum(['paid', 'partially_paid', 'unpaid', 'cancelled']).optional(),
  minOutstanding: z.coerce.number().min(0).optional(),
});
