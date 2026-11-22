import { getClient } from '../../config/db.js';
import { supplierPaymentsRepository } from './supplier-payments.repository.js';
import { roundMoney, SUPPLIER_PAYMENT_STATUS } from './supplier-payments.constants.js';
import { accountingService } from '../accounting/accounting.service.js';
import { STANDARD_ACCOUNTS, SOURCE_TYPES, JOURNAL_ENTRY_STATUS } from '../accounting/accounting.constants.js';

class SupplierPaymentsService {
  async recordPayment(data, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const paymentNumber = await supplierPaymentsRepository.generatePaymentNumber(data.payment_date, client);

      const payment = await supplierPaymentsRepository.createPayment({
        ...data,
        payment_number: paymentNumber,
        recorded_by: user.id,
      }, client);

      // Handle allocations if provided
      if (data.allocations && data.allocations.length > 0) {
        let totalAllocated = 0;
        for (const alloc of data.allocations) {
          totalAllocated = roundMoney(totalAllocated + Number(alloc.allocated_amount));
          if (totalAllocated > Number(payment.total_amount)) {
            const err = new Error('Total allocations exceed payment amount');
            err.statusCode = 400;
            throw err;
          }
          await supplierPaymentsRepository.allocatePayment(
            payment.id,
            alloc.purchase_bill_id,
            alloc.allocated_amount,
            user.id,
            client
          );
        }
      }

      // Financial Accounting Integration: Post entry if status is 'posted'
      if (payment.status === SUPPLIER_PAYMENT_STATUS.POSTED) {
        await this.postPaymentAccounting(payment.id, user.id, client);
      }

      await client.query('COMMIT');
      return supplierPaymentsRepository.findPaymentById(payment.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async postPaymentAccounting(paymentId, userId, externalClient = null) {
    const client = externalClient || (await getClient());
    const shouldManageTx = !externalClient;

    try {
      if (shouldManageTx) await client.query('BEGIN');

      const payment = await supplierPaymentsRepository.findPaymentById(paymentId, client);
      if (!payment) {
        const err = new Error(`Supplier payment ${paymentId} not found`);
        err.statusCode = 404;
        throw err;
      }

      // Check if already posted
      const existingJeRes = await client.query(
        `SELECT id FROM journal_entries 
         WHERE source_type = 'SUPPLIER_PAYMENT' AND source_id = $1 AND status = 'posted'`,
        [paymentId]
      );
      if (existingJeRes.rows.length > 0) {
        if (shouldManageTx) await client.query('COMMIT');
        return;
      }

      const isCash = payment.payment_mode === 'cash';
      const settlementCode = isCash ? STANDARD_ACCOUNTS.CASH_IN_HAND : STANDARD_ACCOUNTS.BANK_OPERATING;

      const apAccRes = await client.query(`SELECT id FROM chart_of_accounts WHERE account_code = $1`, [STANDARD_ACCOUNTS.ACCOUNTS_PAYABLE]);
      const settlementAccRes = await client.query(`SELECT id FROM chart_of_accounts WHERE account_code = $1`, [settlementCode]);

      const apAccId = apAccRes.rows[0].id;
      const settlementAccId = settlementAccRes.rows[0].id;
      const total = roundMoney(Number(payment.total_amount));

      const entryNumber = await accountingService.createJournalEntry({
        entry_date: payment.payment_date ? new Date(payment.payment_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        source_type: 'SUPPLIER_PAYMENT',
        source_id: payment.id,
        source_reference: payment.payment_number,
        narration: `Supplier Payment ${payment.payment_number} to ${payment.supplier_name} via ${payment.payment_mode}`,
        post_immediately: true,
        lines: [
          // DR: Accounts Payable (Creditors)
          {
            account_id: apAccId,
            debit_amount: total,
            credit_amount: 0,
            description: `Payment to ${payment.supplier_name} (${payment.payment_number})`,
            party_id: payment.supplier_id,
          },
          // CR: Cash or Bank
          {
            account_id: settlementAccId,
            debit_amount: 0,
            credit_amount: total,
            description: `Disbursement via ${payment.payment_mode} ref: ${payment.reference_txn_id || payment.payment_number}`,
            party_id: payment.supplier_id,
          },
        ],
      }, { id: userId });

      if (shouldManageTx) await client.query('COMMIT');
    } catch (err) {
      if (shouldManageTx) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageTx) client.release();
    }
  }

  async allocatePayment(paymentId, data, user) {
    const allocId = await supplierPaymentsRepository.allocatePayment(
      paymentId,
      data.purchase_bill_id,
      data.allocated_amount,
      user.id
    );
    return supplierPaymentsRepository.findPaymentById(paymentId);
  }

  async reversePayment(paymentId, data, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const payment = await supplierPaymentsRepository.reversePayment(paymentId, user.id, data.reversal_reason, client);

      // Reversal accounting integration
      const origJeRes = await client.query(
        `SELECT id, reversal_entry_id FROM journal_entries 
         WHERE source_type = 'SUPPLIER_PAYMENT' AND source_id = $1 AND status = 'posted'`,
        [paymentId]
      );

      if (origJeRes.rows.length > 0 && !origJeRes.rows[0].reversal_entry_id) {
        await client.query(`SELECT fn_reverse_journal_entry($1, $2, $3)`, [
          origJeRes.rows[0].id,
          user.id,
          data.reversal_reason,
        ]);
      }

      await client.query('COMMIT');
      return payment;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getPayments(filters = {}) {
    return supplierPaymentsRepository.findPayments(filters);
  }

  async getPaymentById(id) {
    const payment = await supplierPaymentsRepository.findPaymentById(id);
    if (!payment) {
      const err = new Error(`Supplier payment ${id} not found`);
      err.statusCode = 404;
      throw err;
    }
    return payment;
  }

  async getPayablesSummary() {
    return supplierPaymentsRepository.getPayablesSummary();
  }

  async getSupplierOutstanding(filters = {}) {
    return supplierPaymentsRepository.getSupplierOutstanding(filters);
  }

  async getPurchaseBillBalances(filters = {}) {
    return supplierPaymentsRepository.getPurchaseBillBalances(filters);
  }
}

export const supplierPaymentsService = new SupplierPaymentsService();
