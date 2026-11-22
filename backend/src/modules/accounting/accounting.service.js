import { getClient, query } from '../../config/db.js';
import { accountingRepository } from './accounting.repository.js';
import {
  ACCOUNT_TYPES,
  NORMAL_BALANCES,
  JOURNAL_ENTRY_STATUS,
  SOURCE_TYPES,
  STANDARD_ACCOUNTS,
  roundMoney,
} from './accounting.constants.js';

class AccountingService {
  // ============================================================================
  // 1. CHART OF ACCOUNTS
  // ============================================================================

  async getAccounts(filters = {}) {
    return accountingRepository.findAllAccounts(filters);
  }

  async getAccountById(id) {
    const account = await accountingRepository.findAccountById(id);
    if (!account) {
      const err = new Error(`Account with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }
    return account;
  }

  async createAccount(data) {
    // Check for duplicate account_code
    const existing = await accountingRepository.findAccountByCode(data.account_code);
    if (existing) {
      const err = new Error(`Account with code "${data.account_code}" already exists`);
      err.statusCode = 409;
      throw err;
    }

    if (data.parent_account_id) {
      const parent = await accountingRepository.findAccountById(data.parent_account_id);
      if (!parent) {
        const err = new Error(`Parent account with ID ${data.parent_account_id} not found`);
        err.statusCode = 400;
        throw err;
      }
    }

    return accountingRepository.createAccount(data);
  }

  async updateAccount(id, data) {
    const account = await accountingRepository.findAccountById(id);
    if (!account) {
      const err = new Error(`Account with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (account.is_system && data.is_active === false) {
      const err = new Error(`System account "${account.account_code}" cannot be deactivated`);
      err.statusCode = 400;
      throw err;
    }

    return accountingRepository.updateAccount(id, data);
  }

  // ============================================================================
  // 2. JOURNAL ENTRIES (MANUAL & GENERAL)
  // ============================================================================

  async createJournalEntry(data, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Resolve account_id if only account_code is provided
      const resolvedLines = [];
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of data.lines) {
        let accountId = line.account_id;
        if (!accountId && line.account_code) {
          const acc = await accountingRepository.findAccountByCode(line.account_code, client);
          if (!acc) {
            const err = new Error(`Account with code "${line.account_code}" not found`);
            err.statusCode = 400;
            throw err;
          }
          if (!acc.is_active) {
            const err = new Error(`Account "${acc.account_code} - ${acc.account_name}" is inactive`);
            err.statusCode = 400;
            throw err;
          }
          accountId = acc.id;
        } else if (accountId) {
          const acc = await accountingRepository.findAccountById(accountId, client);
          if (!acc) {
            const err = new Error(`Account with ID "${accountId}" not found`);
            err.statusCode = 400;
            throw err;
          }
          if (!acc.is_active) {
            const err = new Error(`Account "${acc.account_code} - ${acc.account_name}" is inactive`);
            err.statusCode = 400;
            throw err;
          }
        }

        const debit = roundMoney(line.debit_amount || 0);
        const credit = roundMoney(line.credit_amount || 0);

        totalDebit = roundMoney(totalDebit + debit);
        totalCredit = roundMoney(totalCredit + credit);

        resolvedLines.push({
          account_id: accountId,
          debit_amount: debit,
          credit_amount: credit,
          description: line.description,
          party_id: line.party_id || null,
        });
      }

      // Strict balance check
      if (Math.abs(totalDebit - totalCredit) > 0.001 || totalDebit <= 0) {
        const err = new Error(
          `Accounting Error: Unbalanced journal entry. Total Debits (₹${totalDebit}) must equal Total Credits (₹${totalCredit}) and be greater than zero.`
        );
        err.statusCode = 400;
        throw err;
      }

      // Generate sequential entry number
      const entryNumber = await accountingRepository.generateEntryNumber(data.entry_date, client);

      const header = {
        entry_number: entryNumber,
        entry_date: data.entry_date,
        accounting_date: data.accounting_date || data.entry_date,
        source_type: data.source_type || SOURCE_TYPES.MANUAL,
        source_id: data.source_id || null,
        source_reference: data.source_reference || null,
        narration: data.narration,
        total_debit: totalDebit,
        total_credit: totalCredit,
        status: data.post_immediately === false ? JOURNAL_ENTRY_STATUS.DRAFT : JOURNAL_ENTRY_STATUS.POSTED,
        posted_by: user.id,
      };

      const result = await accountingRepository.createEntry(header, resolvedLines, client);

      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async postJournalEntry(id, user) {
    const entry = await accountingRepository.findEntryById(id);
    if (!entry) {
      const err = new Error(`Journal entry with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (entry.status === JOURNAL_ENTRY_STATUS.POSTED) {
      const err = new Error(`Journal entry ${entry.entry_number} is already posted`);
      err.statusCode = 400;
      throw err;
    }

    return accountingRepository.postEntry(id, user.id);
  }

  async reverseJournalEntry(id, data, user) {
    const entry = await accountingRepository.findEntryById(id);
    if (!entry) {
      const err = new Error(`Journal entry with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (entry.status === JOURNAL_ENTRY_STATUS.REVERSED || entry.reversal_entry_id) {
      const err = new Error(`Journal entry ${entry.entry_number} has already been reversed`);
      err.statusCode = 400;
      throw err;
    }

    if (entry.status !== JOURNAL_ENTRY_STATUS.POSTED) {
      const err = new Error(`Only posted journal entries can be reversed. Current status: "${entry.status}"`);
      err.statusCode = 400;
      throw err;
    }

    return accountingRepository.reverseEntry(id, user.id, data.reversal_reason);
  }

  async getJournalEntries(filters = {}) {
    return accountingRepository.findAllEntries(filters);
  }

  async getJournalEntryById(id) {
    const entry = await accountingRepository.findEntryById(id);
    if (!entry) {
      const err = new Error(`Journal entry with ID ${id} not found`);
      err.statusCode = 404;
      throw err;
    }
    return entry;
  }

  // ============================================================================
  // 3. OPERATIONAL POSTINGS (INTEGRATED ERP FLOW)
  // ============================================================================

  async postPurchaseBillAccounting(billId, userId, externalClient = null) {
    const client = externalClient || (await getClient());
    const shouldManageTx = !externalClient;

    try {
      if (shouldManageTx) await client.query('BEGIN');

      // Check if already posted
      const existing = await accountingRepository.findEntryBySource(
        SOURCE_TYPES.PURCHASE_BILL,
        billId,
        client
      );
      if (existing) {
        if (shouldManageTx) await client.query('COMMIT');
        return existing;
      }

      // Fetch purchase bill
      const billRes = await client.query(
        `SELECT pb.*, p.trade_name AS supplier_name 
         FROM purchase_bills pb
         JOIN parties p ON pb.supplier_id = p.id
         WHERE pb.id = $1`,
        [billId]
      );

      if (billRes.rows.length === 0) {
        const err = new Error(`Purchase bill ${billId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const bill = billRes.rows[0];
      if (bill.status !== 'received') {
        const err = new Error(`Cannot post accounting for bill with status "${bill.status}". Must be "received".`);
        err.statusCode = 400;
        throw err;
      }

      // Resolve Standard Account IDs
      const rawMatAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.RAW_MATERIALS_INVENTORY, client);
      const cgstInputAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.CGST_INPUT, client);
      const sgstInputAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.SGST_INPUT, client);
      const igstInputAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.IGST_INPUT, client);
      const apAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.ACCOUNTS_PAYABLE, client);

      const subtotal = roundMoney(Number(bill.subtotal_amount) || 0);
      const cgst = roundMoney(Number(bill.cgst_amount) || 0);
      const sgst = roundMoney(Number(bill.sgst_amount) || 0);
      const igst = roundMoney(Number(bill.igst_amount) || 0);
      const total = roundMoney(Number(bill.total_amount) || 0);

      const lines = [];

      // DR: Raw Materials Inventory
      lines.push({
        account_id: rawMatAcc.id,
        debit_amount: subtotal,
        credit_amount: 0,
        description: `Inward raw materials: ${bill.bill_number}`,
        party_id: bill.supplier_id,
      });

      // DR: CGST Input
      if (cgst > 0) {
        lines.push({
          account_id: cgstInputAcc.id,
          debit_amount: cgst,
          credit_amount: 0,
          description: `CGST Input Credit (Bill: ${bill.bill_number})`,
          party_id: bill.supplier_id,
        });
      }

      // DR: SGST Input
      if (sgst > 0) {
        lines.push({
          account_id: sgstInputAcc.id,
          debit_amount: sgst,
          credit_amount: 0,
          description: `SGST Input Credit (Bill: ${bill.bill_number})`,
          party_id: bill.supplier_id,
        });
      }

      // DR: IGST Input
      if (igst > 0) {
        lines.push({
          account_id: igstInputAcc.id,
          debit_amount: igst,
          credit_amount: 0,
          description: `IGST Input Credit (Bill: ${bill.bill_number})`,
          party_id: bill.supplier_id,
        });
      }

      // CR: Accounts Payable
      lines.push({
        account_id: apAcc.id,
        debit_amount: 0,
        credit_amount: total,
        description: `Accounts Payable: ${bill.supplier_name} (${bill.bill_number})`,
        party_id: bill.supplier_id,
      });

      const entryDate = bill.bill_date ? new Date(bill.bill_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const entryNumber = await accountingRepository.generateEntryNumber(entryDate, client);

      const header = {
        entry_number: entryNumber,
        entry_date: entryDate,
        accounting_date: entryDate,
        source_type: SOURCE_TYPES.PURCHASE_BILL,
        source_id: bill.id,
        source_reference: bill.bill_number,
        narration: `Purchase Bill ${bill.bill_number} from ${bill.supplier_name}`,
        total_debit: total,
        total_credit: total,
        status: JOURNAL_ENTRY_STATUS.POSTED,
        posted_by: userId,
      };

      const result = await accountingRepository.createEntry(header, lines, client);

      if (shouldManageTx) await client.query('COMMIT');
      return result;
    } catch (err) {
      if (shouldManageTx) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageTx) client.release();
    }
  }

  async postSalesInvoiceAccounting(invoiceId, userId, externalClient = null) {
    const client = externalClient || (await getClient());
    const shouldManageTx = !externalClient;

    try {
      if (shouldManageTx) await client.query('BEGIN');

      const existing = await accountingRepository.findEntryBySource(
        SOURCE_TYPES.SALES_INVOICE,
        invoiceId,
        client
      );
      if (existing) {
        if (shouldManageTx) await client.query('COMMIT');
        return existing;
      }

      const invRes = await client.query(
        `SELECT inv.*, p.trade_name AS customer_name 
         FROM invoices inv
         JOIN parties p ON inv.customer_id = p.id
         WHERE inv.id = $1`,
        [invoiceId]
      );

      if (invRes.rows.length === 0) {
        const err = new Error(`Invoice ${invoiceId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const inv = invRes.rows[0];

      const arAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.ACCOUNTS_RECEIVABLE, client);
      const revAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.SALES_REVENUE, client);
      const cgstOutAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.CGST_OUTPUT, client);
      const sgstOutAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.SGST_OUTPUT, client);
      const igstOutAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.IGST_OUTPUT, client);

      const taxable = roundMoney(Number(inv.taxable_value) || 0);
      const cgst = roundMoney(Number(inv.cgst_amount) || 0);
      const sgst = roundMoney(Number(inv.sgst_amount) || 0);
      const igst = roundMoney(Number(inv.igst_amount) || 0);
      const total = roundMoney(Number(inv.total_invoice_value) || 0);

      const lines = [];

      // DR: Accounts Receivable
      lines.push({
        account_id: arAcc.id,
        debit_amount: total,
        credit_amount: 0,
        description: `Invoice ${inv.invoice_number} receivable from ${inv.customer_name}`,
        party_id: inv.customer_id,
      });

      // CR: Sales Revenue
      lines.push({
        account_id: revAcc.id,
        debit_amount: 0,
        credit_amount: taxable,
        description: `Sales revenue for Invoice ${inv.invoice_number}`,
        party_id: inv.customer_id,
      });

      // CR: CGST Output
      if (cgst > 0) {
        lines.push({
          account_id: cgstOutAcc.id,
          debit_amount: 0,
          credit_amount: cgst,
          description: `CGST Output Liability (Invoice: ${inv.invoice_number})`,
          party_id: inv.customer_id,
        });
      }

      // CR: SGST Output
      if (sgst > 0) {
        lines.push({
          account_id: sgstOutAcc.id,
          debit_amount: 0,
          credit_amount: sgst,
          description: `SGST Output Liability (Invoice: ${inv.invoice_number})`,
          party_id: inv.customer_id,
        });
      }

      // CR: IGST Output
      if (igst > 0) {
        lines.push({
          account_id: igstOutAcc.id,
          debit_amount: 0,
          credit_amount: igst,
          description: `IGST Output Liability (Invoice: ${inv.invoice_number})`,
          party_id: inv.customer_id,
        });
      }

      const entryDate = inv.invoice_date ? new Date(inv.invoice_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const entryNumber = await accountingRepository.generateEntryNumber(entryDate, client);

      const header = {
        entry_number: entryNumber,
        entry_date: entryDate,
        accounting_date: entryDate,
        source_type: SOURCE_TYPES.SALES_INVOICE,
        source_id: inv.id,
        source_reference: inv.invoice_number,
        narration: `Sales Invoice ${inv.invoice_number} to ${inv.customer_name}`,
        total_debit: total,
        total_credit: total,
        status: JOURNAL_ENTRY_STATUS.POSTED,
        posted_by: userId,
      };

      const result = await accountingRepository.createEntry(header, lines, client);

      if (shouldManageTx) await client.query('COMMIT');
      return result;
    } catch (err) {
      if (shouldManageTx) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageTx) client.release();
    }
  }

  async postSalesDispatchAccounting(dispatchId, userId, externalClient = null) {
    const client = externalClient || (await getClient());
    const shouldManageTx = !externalClient;

    try {
      if (shouldManageTx) await client.query('BEGIN');

      const existing = await accountingRepository.findEntryBySource(
        SOURCE_TYPES.SALES_DISPATCH,
        dispatchId,
        client
      );
      if (existing) {
        if (shouldManageTx) await client.query('COMMIT');
        return existing;
      }

      const dRes = await client.query(
        `SELECT d.*, inv.customer_id, p.trade_name AS customer_name
         FROM dispatches d
         JOIN invoices inv ON d.invoice_id = inv.id
         JOIN parties p ON inv.customer_id = p.id
         WHERE d.id = $1`,
        [dispatchId]
      );

      if (dRes.rows.length === 0) {
        const err = new Error(`Dispatch ${dispatchId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const dispatch = dRes.rows[0];

      // Calculate COGS directly from inventory_ledger for this dispatch's items
      const cogsRes = await client.query(
        `SELECT COALESCE(SUM(ABS(total_cost)), 0.00) AS total_cogs
         FROM inventory_ledger
         WHERE dispatch_item_id IN (
           SELECT id FROM dispatch_items WHERE dispatch_id = $1
         )`,
        [dispatchId]
      );

      const totalCogs = roundMoney(Number(cogsRes.rows[0]?.total_cogs) || 0);
      if (totalCogs <= 0) {
        // If no cogs recorded in ledger, nothing to post
        if (shouldManageTx) await client.query('COMMIT');
        return null;
      }

      const cogsAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.COGS_DIRECT_MATERIALS, client);
      const fgAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.FINISHED_GOODS_INVENTORY, client);

      const lines = [
        {
          account_id: cogsAcc.id,
          debit_amount: totalCogs,
          credit_amount: 0,
          description: `COGS: Goods dispatched under ${dispatch.dispatch_number}`,
          party_id: dispatch.customer_id,
        },
        {
          account_id: fgAcc.id,
          debit_amount: 0,
          credit_amount: totalCogs,
          description: `Finished goods inventory reduction: ${dispatch.dispatch_number}`,
          party_id: dispatch.customer_id,
        },
      ];

      const entryDate = dispatch.dispatch_date ? new Date(dispatch.dispatch_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const entryNumber = await accountingRepository.generateEntryNumber(entryDate, client);

      const header = {
        entry_number: entryNumber,
        entry_date: entryDate,
        accounting_date: entryDate,
        source_type: SOURCE_TYPES.SALES_DISPATCH,
        source_id: dispatch.id,
        source_reference: dispatch.dispatch_number,
        narration: `Cost of Goods Sold for Dispatch ${dispatch.dispatch_number} (${dispatch.customer_name})`,
        total_debit: totalCogs,
        total_credit: totalCogs,
        status: JOURNAL_ENTRY_STATUS.POSTED,
        posted_by: userId,
      };

      const result = await accountingRepository.createEntry(header, lines, client);

      if (shouldManageTx) await client.query('COMMIT');
      return result;
    } catch (err) {
      if (shouldManageTx) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageTx) client.release();
    }
  }

  async postProductionRunAccounting(runId, userId, externalClient = null) {
    const client = externalClient || (await getClient());
    const shouldManageTx = !externalClient;

    try {
      if (shouldManageTx) await client.query('BEGIN');

      const existing = await accountingRepository.findEntryBySource(
        SOURCE_TYPES.PRODUCTION_RUN,
        runId,
        client
      );
      if (existing) {
        if (shouldManageTx) await client.query('COMMIT');
        return existing;
      }

      const prRes = await client.query(
        `SELECT pr.*, i.name AS fg_item_name, prc.total_raw_material_cost, prc.total_packaging_cost, prc.total_direct_overhead_cost, prc.gross_total_batch_cost
         FROM production_runs pr
         JOIN items i ON pr.finished_good_item_id = i.id
         LEFT JOIN production_run_costing prc ON pr.id = prc.production_run_id
         WHERE pr.id = $1`,
        [runId]
      );

      if (prRes.rows.length === 0) {
        const err = new Error(`Production run ${runId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const run = prRes.rows[0];
      if (run.status !== 'completed') {
        const err = new Error(`Cannot post accounting for production run with status "${run.status}". Must be "completed".`);
        err.statusCode = 400;
        throw err;
      }

      const rawMatCost = Number(run.total_raw_material_cost) || 0;
      const pkgCost = Number(run.total_packaging_cost) || 0;
      const directOverheadCost = Number(run.total_direct_overhead_cost) || 0;
      const materialCost = roundMoney(rawMatCost + pkgCost);
      const overheadCost = roundMoney(directOverheadCost);
      const totalBatchCost = roundMoney(Number(run.gross_total_batch_cost) || (materialCost + overheadCost));

      if (totalBatchCost <= 0) {
        if (shouldManageTx) await client.query('COMMIT');
        return null;
      }

      const fgAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.FINISHED_GOODS_INVENTORY, client);
      const rmAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.RAW_MATERIALS_INVENTORY, client);
      const ovhAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.OVERHEADS_ABSORBED, client);

      const lines = [
        // DR: Finished Goods Inventory
        {
          account_id: fgAcc.id,
          debit_amount: totalBatchCost,
          credit_amount: 0,
          description: `FG Yield: ${run.run_number} (${run.output_batch_number}) - ${run.fg_item_name}`,
        },
      ];

      // CR: Raw Materials Inventory
      if (materialCost > 0) {
        lines.push({
          account_id: rmAcc.id,
          debit_amount: 0,
          credit_amount: materialCost,
          description: `Raw materials consumed in batch: ${run.run_number}`,
        });
      }

      // CR: Manufacturing Overheads Absorbed
      if (overheadCost > 0) {
        lines.push({
          account_id: ovhAcc.id,
          debit_amount: 0,
          credit_amount: overheadCost,
          description: `Direct overheads absorbed in batch: ${run.run_number}`,
        });
      }

      // If due to rounding or missing split materialCost + overheadCost != totalBatchCost, balance to rmAcc
      const totalCredit = roundMoney(lines.reduce((s, l) => s + l.credit_amount, 0));
      if (totalCredit !== totalBatchCost) {
        lines[1].credit_amount = roundMoney(totalBatchCost - (lines[2]?.credit_amount || 0));
      }

      const entryDate = run.run_date ? new Date(run.run_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const entryNumber = await accountingRepository.generateEntryNumber(entryDate, client);

      const header = {
        entry_number: entryNumber,
        entry_date: entryDate,
        accounting_date: entryDate,
        source_type: SOURCE_TYPES.PRODUCTION_RUN,
        source_id: run.id,
        source_reference: run.run_number,
        narration: `Production Run Completed: ${run.run_number} (${run.output_batch_number}) - ${run.fg_item_name}`,
        total_debit: totalBatchCost,
        total_credit: totalBatchCost,
        status: JOURNAL_ENTRY_STATUS.POSTED,
        posted_by: userId,
      };

      const result = await accountingRepository.createEntry(header, lines, client);

      if (shouldManageTx) await client.query('COMMIT');
      return result;
    } catch (err) {
      if (shouldManageTx) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageTx) client.release();
    }
  }

  async postCustomerPaymentAccounting(paymentId, userId, externalClient = null) {
    const client = externalClient || (await getClient());
    const shouldManageTx = !externalClient;

    try {
      if (shouldManageTx) await client.query('BEGIN');

      const existing = await accountingRepository.findEntryBySource(
        SOURCE_TYPES.CUSTOMER_PAYMENT,
        paymentId,
        client
      );
      if (existing) {
        if (shouldManageTx) await client.query('COMMIT');
        return existing;
      }

      const payRes = await client.query(
        `SELECT pay.*, p.trade_name AS customer_name 
         FROM payments pay
         JOIN parties p ON pay.customer_id = p.id
         WHERE pay.id = $1`,
        [paymentId]
      );

      if (payRes.rows.length === 0) {
        const err = new Error(`Payment ${paymentId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const pay = payRes.rows[0];
      if (pay.status !== 'posted') {
        const err = new Error(`Cannot post accounting for payment with status "${pay.status}". Must be "posted".`);
        err.statusCode = 400;
        throw err;
      }

      const isCash = pay.payment_mode === 'cash';
      const settlementCode = isCash ? STANDARD_ACCOUNTS.CASH_IN_HAND : STANDARD_ACCOUNTS.BANK_OPERATING;

      const settlementAcc = await accountingRepository.findAccountByCode(settlementCode, client);
      const arAcc = await accountingRepository.findAccountByCode(STANDARD_ACCOUNTS.ACCOUNTS_RECEIVABLE, client);

      const total = roundMoney(Number(pay.total_amount) || 0);

      const lines = [
        // DR: Cash or Bank
        {
          account_id: settlementAcc.id,
          debit_amount: total,
          credit_amount: 0,
          description: `Customer receipt ${pay.receipt_number} via ${pay.payment_mode}`,
          party_id: pay.customer_id,
        },
        // CR: Accounts Receivable
        {
          account_id: arAcc.id,
          debit_amount: 0,
          credit_amount: total,
          description: `Accounts Receivable clearance: ${pay.receipt_number} (${pay.customer_name})`,
          party_id: pay.customer_id,
        },
      ];

      const entryDate = pay.payment_date ? new Date(pay.payment_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const entryNumber = await accountingRepository.generateEntryNumber(entryDate, client);

      const header = {
        entry_number: entryNumber,
        entry_date: entryDate,
        accounting_date: entryDate,
        source_type: SOURCE_TYPES.CUSTOMER_PAYMENT,
        source_id: pay.id,
        source_reference: pay.receipt_number,
        narration: `Customer Payment ${pay.receipt_number} received from ${pay.customer_name} via ${pay.payment_mode}`,
        total_debit: total,
        total_credit: total,
        status: JOURNAL_ENTRY_STATUS.POSTED,
        posted_by: userId,
      };

      const result = await accountingRepository.createEntry(header, lines, client);

      if (shouldManageTx) await client.query('COMMIT');
      return result;
    } catch (err) {
      if (shouldManageTx) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageTx) client.release();
    }
  }

  async postPaymentReversalAccounting(paymentId, userId, externalClient = null) {
    const client = externalClient || (await getClient());
    const shouldManageTx = !externalClient;

    try {
      if (shouldManageTx) await client.query('BEGIN');

      const payRes = await client.query(
        `SELECT * FROM payments WHERE id = $1`,
        [paymentId]
      );

      if (payRes.rows.length === 0) {
        const err = new Error(`Payment ${paymentId} not found`);
        err.statusCode = 404;
        throw err;
      }

      const pay = payRes.rows[0];
      if (pay.status !== 'reversed') {
        const err = new Error(`Payment ${paymentId} is not in "reversed" status`);
        err.statusCode = 400;
        throw err;
      }

      // Check if original journal entry was posted
      const origJe = await accountingRepository.findEntryBySource(
        SOURCE_TYPES.CUSTOMER_PAYMENT,
        paymentId,
        client
      );

      let result;
      if (origJe) {
        if (!origJe.reversal_entry_id) {
          result = await accountingRepository.reverseEntry(
            origJe.id,
            userId,
            pay.reversal_reason || 'Payment reversal',
            client
          );
        } else {
          result = await accountingRepository.findEntryById(origJe.reversal_entry_id, client);
        }
      }

      if (shouldManageTx) await client.query('COMMIT');
      return result;
    } catch (err) {
      if (shouldManageTx) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageTx) client.release();
    }
  }

  async syncOperationalTransactions(userId) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      let purchaseBillsSynced = 0;
      let salesInvoicesSynced = 0;
      let dispatchesSynced = 0;
      let productionRunsSynced = 0;
      let paymentsSynced = 0;
      let reversalsSynced = 0;

      // 1. Sync Purchase Bills
      const pbs = await client.query(
        `SELECT id FROM purchase_bills WHERE status = 'received' 
         AND id NOT IN (SELECT source_id FROM journal_entries WHERE source_type = 'PURCHASE_BILL' AND status = 'posted')`
      );
      for (const row of pbs.rows) {
        await this.postPurchaseBillAccounting(row.id, userId, client);
        purchaseBillsSynced++;
      }

      // 2. Sync Production Runs
      const prs = await client.query(
        `SELECT id FROM production_runs WHERE status = 'completed'
         AND id NOT IN (SELECT source_id FROM journal_entries WHERE source_type = 'PRODUCTION_RUN' AND status = 'posted')`
      );
      for (const row of prs.rows) {
        await this.postProductionRunAccounting(row.id, userId, client);
        productionRunsSynced++;
      }

      // 3. Sync Sales Invoices
      const invs = await client.query(
        `SELECT id FROM invoices WHERE status IN ('dispatched', 'approved', 'paid')
         AND id NOT IN (SELECT source_id FROM journal_entries WHERE source_type = 'SALES_INVOICE' AND status = 'posted')`
      );
      for (const row of invs.rows) {
        await this.postSalesInvoiceAccounting(row.id, userId, client);
        salesInvoicesSynced++;
      }

      // 4. Sync Dispatches (COGS)
      const ds = await client.query(
        `SELECT id FROM dispatches WHERE status = 'dispatched'
         AND id NOT IN (SELECT source_id FROM journal_entries WHERE source_type = 'SALES_DISPATCH' AND status = 'posted')`
      );
      for (const row of ds.rows) {
        const res = await this.postSalesDispatchAccounting(row.id, userId, client);
        if (res) dispatchesSynced++;
      }

      // 5. Sync Payments
      const pays = await client.query(
        `SELECT id FROM payments WHERE status = 'posted'
         AND id NOT IN (SELECT source_id FROM journal_entries WHERE source_type = 'CUSTOMER_PAYMENT' AND status = 'posted')`
      );
      for (const row of pays.rows) {
        await this.postCustomerPaymentAccounting(row.id, userId, client);
        paymentsSynced++;
      }

      // 6. Sync Payment Reversals
      const revPays = await client.query(
        `SELECT id FROM payments WHERE status = 'reversed'`
      );
      for (const row of revPays.rows) {
        const origJe = await accountingRepository.findEntryBySource(
          SOURCE_TYPES.CUSTOMER_PAYMENT,
          row.id,
          client
        );
        if (origJe && !origJe.reversal_entry_id) {
          await this.postPaymentReversalAccounting(row.id, userId, client);
          reversalsSynced++;
        }
      }

      await client.query('COMMIT');

      return {
        purchase_bills_synced: purchaseBillsSynced,
        sales_invoices_synced: salesInvoicesSynced,
        dispatches_synced: dispatchesSynced,
        production_runs_synced: productionRunsSynced,
        payments_synced: paymentsSynced,
        reversals_synced: reversalsSynced,
        total_synced:
          purchaseBillsSynced +
          salesInvoicesSynced +
          dispatchesSynced +
          productionRunsSynced +
          paymentsSynced +
          reversalsSynced,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // 4. GENERAL LEDGER & STATUTORY REPORTING
  // ============================================================================

  async getGeneralLedger(filters = {}) {
    const rawLines = await accountingRepository.getGeneralLedger(filters);

    // Compute running balance per account
    const accountBalances = {};
    const ledger = rawLines.map((line) => {
      const accId = line.account_id;
      if (!accountBalances[accId]) {
        accountBalances[accId] = 0;
      }

      const netDelta = Number(line.net_line_amount) || 0;
      accountBalances[accId] = roundMoney(accountBalances[accId] + netDelta);

      return {
        ...line,
        running_balance: accountBalances[accId],
      };
    });

    return ledger;
  }

  async getTrialBalance(filters = {}) {
    const accounts = await accountingRepository.getTrialBalance(filters);

    let totalDebit = 0;
    let totalCredit = 0;
    let totalNetDebit = 0;
    let totalNetCredit = 0;

    for (const a of accounts) {
      totalDebit = roundMoney(totalDebit + Number(a.total_debit));
      totalCredit = roundMoney(totalCredit + Number(a.total_credit));
      totalNetDebit = roundMoney(totalNetDebit + Number(a.net_debit_balance));
      totalNetCredit = roundMoney(totalNetCredit + Number(a.net_credit_balance));
    }

    const variance = roundMoney(Math.abs(totalNetDebit - totalNetCredit));
    const isBalanced = variance < 0.001;

    return {
      as_of_date: filters.as_of_date || new Date().toISOString().split('T')[0],
      is_balanced: isBalanced,
      total_gross_debit: totalDebit,
      total_gross_credit: totalCredit,
      total_net_debit: totalNetDebit,
      total_net_credit: totalNetCredit,
      variance,
      accounts,
    };
  }

  async getProfitAndLoss(filters = {}) {
    const rows = await accountingRepository.getProfitAndLoss(filters);

    const revenueAccounts = [];
    const expenseAccounts = [];
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalManufacturingOverhead = 0;
    let totalOperatingExpense = 0;

    for (const row of rows) {
      const net = Number(row.net_amount) || 0;
      if (row.account_type === ACCOUNT_TYPES.REVENUE) {
        revenueAccounts.push(row);
        totalRevenue = roundMoney(totalRevenue + net);
      } else if (row.account_type === ACCOUNT_TYPES.EXPENSE) {
        expenseAccounts.push(row);
        if (row.category === 'cost_of_goods_sold') {
          totalCOGS = roundMoney(totalCOGS + net);
        } else if (row.category === 'manufacturing_overhead') {
          totalManufacturingOverhead = roundMoney(totalManufacturingOverhead + net);
        } else {
          totalOperatingExpense = roundMoney(totalOperatingExpense + net);
        }
      }
    }

    const totalExpense = roundMoney(totalCOGS + totalManufacturingOverhead + totalOperatingExpense);
    const grossProfit = roundMoney(totalRevenue - totalCOGS);
    const grossMarginPct = totalRevenue > 0 ? roundMoney((grossProfit / totalRevenue) * 100) : 0;
    const netProfit = roundMoney(totalRevenue - totalExpense);
    const netProfitMarginPct = totalRevenue > 0 ? roundMoney((netProfit / totalRevenue) * 100) : 0;

    return {
      as_of_date: filters.as_of_date || new Date().toISOString().split('T')[0],
      from_date: filters.from_date || null,
      to_date: filters.to_date || null,
      revenue: {
        accounts: revenueAccounts,
        total: totalRevenue,
      },
      cost_of_goods_sold: {
        accounts: expenseAccounts.filter((a) => a.category === 'cost_of_goods_sold'),
        total: totalCOGS,
      },
      gross_profit: grossProfit,
      gross_margin_pct: grossMarginPct,
      manufacturing_overheads: {
        accounts: expenseAccounts.filter((a) => a.category === 'manufacturing_overhead'),
        total: totalManufacturingOverhead,
      },
      operating_expenses: {
        accounts: expenseAccounts.filter((a) => a.category === 'operating_expense'),
        total: totalOperatingExpense,
      },
      total_expenses: totalExpense,
      net_profit: netProfit,
      net_profit_margin_pct: netProfitMarginPct,
    };
  }

  async getBalanceSheet(filters = {}) {
    // 1. Get Trial Balance to inspect all account balances
    const tb = await this.getTrialBalance(filters);

    // 2. Get Net Profit from P&L for current period
    const pl = await this.getProfitAndLoss(filters);
    const currentPeriodNetProfit = pl.net_profit;

    const currentAssets = [];
    const nonCurrentAssets = [];
    let totalAssets = 0;

    const currentLiabilities = [];
    const nonCurrentLiabilities = [];
    let totalLiabilities = 0;

    const equityAccounts = [];
    let totalContributedEquity = 0;

    for (const acc of tb.accounts) {
      const netDebit = Number(acc.net_debit_balance) || 0;
      const netCredit = Number(acc.net_credit_balance) || 0;

      if (acc.account_type === ACCOUNT_TYPES.ASSET) {
        const assetBalance = roundMoney(netDebit - netCredit);
        currentAssets.push({ ...acc, balance: assetBalance });
        totalAssets = roundMoney(totalAssets + assetBalance);
      } else if (acc.account_type === ACCOUNT_TYPES.LIABILITY) {
        const liabilityBalance = roundMoney(netCredit - netDebit);
        currentLiabilities.push({ ...acc, balance: liabilityBalance });
        totalLiabilities = roundMoney(totalLiabilities + liabilityBalance);
      } else if (acc.account_type === ACCOUNT_TYPES.EQUITY) {
        const equityBalance = roundMoney(netCredit - netDebit);
        equityAccounts.push({ ...acc, balance: equityBalance });
        totalContributedEquity = roundMoney(totalContributedEquity + equityBalance);
      }
    }

    const totalEquity = roundMoney(totalContributedEquity + currentPeriodNetProfit);
    const totalLiabilitiesAndEquity = roundMoney(totalLiabilities + totalEquity);
    const variance = roundMoney(Math.abs(totalAssets - totalLiabilitiesAndEquity));
    const isBalanced = variance < 0.001;

    return {
      as_of_date: filters.as_of_date || new Date().toISOString().split('T')[0],
      is_balanced: isBalanced,
      variance,
      assets: {
        current_assets: currentAssets,
        non_current_assets: nonCurrentAssets,
        total_assets: totalAssets,
      },
      liabilities: {
        current_liabilities: currentLiabilities,
        non_current_liabilities: nonCurrentLiabilities,
        total_liabilities: totalLiabilities,
      },
      equity: {
        contributed_accounts: equityAccounts,
        total_contributed_equity: totalContributedEquity,
        current_period_net_profit: currentPeriodNetProfit,
        total_equity: totalEquity,
      },
      total_liabilities_and_equity: totalLiabilitiesAndEquity,
    };
  }

  async getCashBankSummary() {
    const accounts = await accountingRepository.getCashBankSummary();
    let totalCashBank = 0;

    for (const a of accounts) {
      totalCashBank = roundMoney(totalCashBank + Number(a.current_balance));
    }

    return {
      total_cash_and_bank: totalCashBank,
      accounts,
    };
  }

  async getGstReconciliation() {
    return accountingRepository.getGstReconciliation();
  }
}

export const accountingService = new AccountingService();
