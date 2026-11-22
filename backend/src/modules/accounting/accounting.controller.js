import { accountingService } from './accounting.service.js';

// ============================================================================
// 1. CHART OF ACCOUNTS
// ============================================================================

export const getAccounts = async (req, res, next) => {
  try {
    const result = await accountingService.getAccounts(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAccountById = async (req, res, next) => {
  try {
    const result = await accountingService.getAccountById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const createAccount = async (req, res, next) => {
  try {
    const result = await accountingService.createAccount(req.body);
    res.status(201).json({
      success: true,
      message: 'Chart of accounts code created successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateAccount = async (req, res, next) => {
  try {
    const result = await accountingService.updateAccount(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Account updated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================================
// 2. JOURNAL ENTRIES
// ============================================================================

export const createJournalEntry = async (req, res, next) => {
  try {
    const result = await accountingService.createJournalEntry(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Journal entry created successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postJournalEntry = async (req, res, next) => {
  try {
    const result = await accountingService.postJournalEntry(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Journal entry posted successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const reverseJournalEntry = async (req, res, next) => {
  try {
    const result = await accountingService.reverseJournalEntry(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Journal entry reversed successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getJournalEntries = async (req, res, next) => {
  try {
    const result = await accountingService.getJournalEntries(req.query);
    res.status(200).json({
      success: true,
      data: result.entries,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getJournalEntryById = async (req, res, next) => {
  try {
    const result = await accountingService.getJournalEntryById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================================
// 3. OPERATIONAL SYNC & POSTINGS
// ============================================================================

export const syncOperationalTransactions = async (req, res, next) => {
  try {
    const result = await accountingService.syncOperationalTransactions(req.user.id);
    res.status(200).json({
      success: true,
      message: 'Operational transactions synchronized to general ledger successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postPurchaseBillAccounting = async (req, res, next) => {
  try {
    const result = await accountingService.postPurchaseBillAccounting(req.params.id, req.user.id);
    res.status(200).json({
      success: true,
      message: 'Purchase bill posted to accounting successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postSalesInvoiceAccounting = async (req, res, next) => {
  try {
    const result = await accountingService.postSalesInvoiceAccounting(req.params.id, req.user.id);
    res.status(200).json({
      success: true,
      message: 'Sales invoice posted to accounting successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postSalesDispatchAccounting = async (req, res, next) => {
  try {
    const result = await accountingService.postSalesDispatchAccounting(req.params.id, req.user.id);
    res.status(200).json({
      success: true,
      message: 'Sales dispatch COGS posted to accounting successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postProductionRunAccounting = async (req, res, next) => {
  try {
    const result = await accountingService.postProductionRunAccounting(req.params.id, req.user.id);
    res.status(200).json({
      success: true,
      message: 'Production run posted to accounting successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postCustomerPaymentAccounting = async (req, res, next) => {
  try {
    const result = await accountingService.postCustomerPaymentAccounting(req.params.id, req.user.id);
    res.status(200).json({
      success: true,
      message: 'Customer payment posted to accounting successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================================
// 4. GENERAL LEDGER & STATUTORY REPORTS
// ============================================================================

export const getGeneralLedger = async (req, res, next) => {
  try {
    const result = await accountingService.getGeneralLedger(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getTrialBalance = async (req, res, next) => {
  try {
    const result = await accountingService.getTrialBalance(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getProfitAndLoss = async (req, res, next) => {
  try {
    const result = await accountingService.getProfitAndLoss(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getBalanceSheet = async (req, res, next) => {
  try {
    const result = await accountingService.getBalanceSheet(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getCashBankSummary = async (req, res, next) => {
  try {
    const result = await accountingService.getCashBankSummary();
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getGstReconciliation = async (req, res, next) => {
  try {
    const result = await accountingService.getGstReconciliation();
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
