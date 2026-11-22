import { z } from 'zod';
import { ACCOUNT_TYPES, NORMAL_BALANCES, JOURNAL_ENTRY_STATUS, SOURCE_TYPES, roundMoney } from './accounting.constants.js';

// ============================================================================
// 1. CHART OF ACCOUNTS SCHEMAS
// ============================================================================

export const createAccountSchema = z.object({
  account_code: z
    .string({ required_error: 'account_code is required' })
    .trim()
    .min(3, 'account_code must be at least 3 characters')
    .max(20, 'account_code cannot exceed 20 characters')
    .regex(/^[0-9A-Za-z.-]+$/, 'account_code must contain only alphanumeric characters, dots, or hyphens'),
  account_name: z
    .string({ required_error: 'account_name is required' })
    .trim()
    .min(3, 'account_name must be at least 3 characters')
    .max(100, 'account_name cannot exceed 100 characters'),
  account_type: z.enum(
    [
      ACCOUNT_TYPES.ASSET,
      ACCOUNT_TYPES.LIABILITY,
      ACCOUNT_TYPES.EQUITY,
      ACCOUNT_TYPES.REVENUE,
      ACCOUNT_TYPES.EXPENSE,
    ],
    { required_error: 'account_type is required' }
  ),
  category: z
    .string({ required_error: 'category is required' })
    .trim()
    .min(2, 'category must be at least 2 characters')
    .max(50, 'category cannot exceed 50 characters'),
  normal_balance: z.enum(
    [NORMAL_BALANCES.DEBIT, NORMAL_BALANCES.CREDIT],
    { required_error: 'normal_balance is required' }
  ),
  parent_account_id: z.string().uuid('parent_account_id must be a valid UUID').optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

export const updateAccountSchema = z.object({
  account_name: z.string().trim().min(3).max(100).optional(),
  category: z.string().trim().min(2).max(50).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  is_active: z.boolean().optional(),
});

// ============================================================================
// 2. JOURNAL ENTRY SCHEMAS
// ============================================================================

export const journalEntryLineSchema = z.object({
  account_id: z.string().uuid('account_id must be a valid UUID').optional(),
  account_code: z.string().trim().optional(),
  debit_amount: z.coerce.number().min(0, 'debit_amount must be non-negative').default(0),
  credit_amount: z.coerce.number().min(0, 'credit_amount must be non-negative').default(0),
  description: z.string().trim().max(255).optional().nullable(),
  party_id: z.string().uuid('party_id must be a valid UUID').optional().nullable(),
}).refine(
  (data) => data.account_id || data.account_code,
  { message: 'Either account_id or account_code must be provided for each line', path: ['account_id'] }
).refine(
  (data) => (data.debit_amount > 0 && data.credit_amount === 0) || (data.credit_amount > 0 && data.debit_amount === 0),
  { message: 'Line must have either a debit or credit amount, but not both or zero', path: ['debit_amount'] }
);

export const createJournalEntrySchema = z.object({
  entry_date: z
    .string({ required_error: 'entry_date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'entry_date must be in YYYY-MM-DD format'),
  accounting_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'accounting_date must be in YYYY-MM-DD format')
    .optional(),
  narration: z
    .string({ required_error: 'narration is required' })
    .trim()
    .min(3, 'narration must be at least 3 characters')
    .max(1000, 'narration cannot exceed 1000 characters'),
  source_type: z.enum([
    SOURCE_TYPES.MANUAL,
    SOURCE_TYPES.PURCHASE_BILL,
    SOURCE_TYPES.SALES_INVOICE,
    SOURCE_TYPES.SALES_DISPATCH,
    SOURCE_TYPES.PRODUCTION_RUN,
    SOURCE_TYPES.CUSTOMER_PAYMENT,
    SOURCE_TYPES.PAYMENT_REVERSAL,
  ]).default(SOURCE_TYPES.MANUAL),
  source_id: z.string().uuid('source_id must be a valid UUID').optional().nullable(),
  source_reference: z.string().trim().max(100).optional().nullable(),
  lines: z
    .array(journalEntryLineSchema)
    .min(2, 'Journal entry must contain at least 2 line items'),
  post_immediately: z.boolean().default(true),
}).refine(
  (data) => {
    const totalDebit = roundMoney(data.lines.reduce((sum, l) => sum + (Number(l.debit_amount) || 0), 0));
    const totalCredit = roundMoney(data.lines.reduce((sum, l) => sum + (Number(l.credit_amount) || 0), 0));
    return Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
  },
  { message: 'Journal entry is unbalanced: Total Debits must equal Total Credits and be greater than zero', path: ['lines'] }
);

export const reverseJournalEntrySchema = z.object({
  reversal_reason: z
    .string({ required_error: 'reversal_reason is required' })
    .trim()
    .min(3, 'reversal_reason must be at least 3 characters')
    .max(500, 'reversal_reason cannot exceed 500 characters'),
});

// ============================================================================
// 3. QUERY SCHEMAS
// ============================================================================

export const queryJournalEntriesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum([
    JOURNAL_ENTRY_STATUS.DRAFT,
    JOURNAL_ENTRY_STATUS.POSTED,
    JOURNAL_ENTRY_STATUS.REVERSED,
  ]).optional(),
  source_type: z.string().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  account_id: z.string().uuid().optional(),
  party_id: z.string().uuid().optional(),
});

export const queryLedgerSchema = z.object({
  account_id: z.string().uuid().optional(),
  account_code: z.string().optional(),
  party_id: z.string().uuid().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const queryFinancialStatementsSchema = z.object({
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
