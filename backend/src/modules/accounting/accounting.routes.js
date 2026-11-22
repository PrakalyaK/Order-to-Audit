import { Router } from 'express';
import * as accountingController from './accounting.controller.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { authorizeRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { ROLES } from '../auth/auth.constants.js';
import {
  createAccountSchema,
  updateAccountSchema,
  createJournalEntrySchema,
  reverseJournalEntrySchema,
  queryJournalEntriesSchema,
  queryLedgerSchema,
  queryFinancialStatementsSchema,
} from './accounting.validation.js';

const router = Router();

// Protect all accounting routes with JWT authentication
router.use(authenticate);

// RBAC Role Definitions
const VIEW_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
  ROLES.AUDITOR,
];

const OPS_ROLES = [
  ROLES.OWNER,
  ROLES.FACTORY_ADMIN,
];

// ============================================================================
// 1. STATUTORY REPORTS & GENERAL LEDGER (Must precede `/:id` parameterized routes)
// ============================================================================

router.get(
  '/ledger',
  authorizeRoles(...VIEW_ROLES),
  validate(queryLedgerSchema, 'query'),
  accountingController.getGeneralLedger
);

router.get(
  '/reports/trial-balance',
  authorizeRoles(...VIEW_ROLES),
  validate(queryFinancialStatementsSchema, 'query'),
  accountingController.getTrialBalance
);

router.get(
  '/reports/profit-and-loss',
  authorizeRoles(...VIEW_ROLES),
  validate(queryFinancialStatementsSchema, 'query'),
  accountingController.getProfitAndLoss
);

router.get(
  '/reports/balance-sheet',
  authorizeRoles(...VIEW_ROLES),
  validate(queryFinancialStatementsSchema, 'query'),
  accountingController.getBalanceSheet
);

router.get(
  '/reports/cash-bank',
  authorizeRoles(...VIEW_ROLES),
  accountingController.getCashBankSummary
);

router.get(
  '/reports/gst-reconciliation',
  authorizeRoles(...VIEW_ROLES),
  accountingController.getGstReconciliation
);

// ============================================================================
// 2. OPERATIONAL SYNCHRONIZATION & POSTING
// ============================================================================

router.post(
  '/sync',
  authorizeRoles(...OPS_ROLES),
  accountingController.syncOperationalTransactions
);

router.post(
  '/post/purchase-bill/:id',
  authorizeRoles(...OPS_ROLES),
  accountingController.postPurchaseBillAccounting
);

router.post(
  '/post/sales-invoice/:id',
  authorizeRoles(...OPS_ROLES),
  accountingController.postSalesInvoiceAccounting
);

router.post(
  '/post/dispatch/:id',
  authorizeRoles(...OPS_ROLES),
  accountingController.postSalesDispatchAccounting
);

router.post(
  '/post/production-run/:id',
  authorizeRoles(...OPS_ROLES),
  accountingController.postProductionRunAccounting
);

router.post(
  '/post/payment/:id',
  authorizeRoles(...OPS_ROLES),
  accountingController.postCustomerPaymentAccounting
);

// ============================================================================
// 3. CHART OF ACCOUNTS
// ============================================================================

router.get(
  '/accounts',
  authorizeRoles(...VIEW_ROLES),
  accountingController.getAccounts
);

router.post(
  '/accounts',
  authorizeRoles(...OPS_ROLES),
  validate(createAccountSchema),
  accountingController.createAccount
);

router.get(
  '/accounts/:id',
  authorizeRoles(...VIEW_ROLES),
  accountingController.getAccountById
);

router.patch(
  '/accounts/:id',
  authorizeRoles(...OPS_ROLES),
  validate(updateAccountSchema),
  accountingController.updateAccount
);

// ============================================================================
// 4. JOURNAL ENTRIES
// ============================================================================

router.get(
  '/journal-entries',
  authorizeRoles(...VIEW_ROLES),
  validate(queryJournalEntriesSchema, 'query'),
  accountingController.getJournalEntries
);

router.post(
  '/journal-entries',
  authorizeRoles(...OPS_ROLES),
  validate(createJournalEntrySchema),
  accountingController.createJournalEntry
);

router.get(
  '/journal-entries/:id',
  authorizeRoles(...VIEW_ROLES),
  accountingController.getJournalEntryById
);

router.post(
  '/journal-entries/:id/post',
  authorizeRoles(...OPS_ROLES),
  accountingController.postJournalEntry
);

router.post(
  '/journal-entries/:id/reverse',
  authorizeRoles(...OPS_ROLES),
  validate(reverseJournalEntrySchema),
  accountingController.reverseJournalEntry
);

export default router;
