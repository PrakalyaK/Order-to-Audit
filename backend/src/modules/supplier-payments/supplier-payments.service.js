import { getClient } from '../../config/db.js';
import { supplierPaymentsRepository } from './supplier-payments.repository.js';
import { roundMoney, SUPPLIER_PAYMENT_STATUS } from './supplier-payments.constants.js';
import { accountingService } from '../accounting/accounting.service.js';
import { accountingRepository } from '../accounting/accounting.repository.js';
import { STANDARD_ACCOUNTS, SOURCE_TYPES, JOURNAL_ENTRY_STATUS } from '../accounting/accounting.constants.js';

class SupplierPaymentsService {
  async recordPayment(data, user) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const paymentNumber = await supplierPaymentsRepository.generatePaymentNumber(data.payment_date, client);

      const totalAmount = roundMoney(data.total_amount !== undefined ? data.total_amount : data.amount);
      const referenceTxnId = data.reference_txn_id || data.reference_number || null;

      const payment = await supplierPaymentsRepository.createPayment({
        ...data,
        total_amount: totalAmount,
        reference_txn_id: referenceTxnId,
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

      // Reversal accounting integration: create reversing entry with source_type 'SUPPLIER_PAYMENT_REVERSAL'
      const origJeRes = await client.query(
        `SELECT id, total_debit, total_credit FROM journal_entries 
         WHERE source_type = 'SUPPLIER_PAYMENT' AND source_id = $1 AND status = 'posted'`,
        [paymentId]
      );

      if (origJeRes.rows.length > 0) {
        const origJe = origJeRes.rows[0];
        const linesRes = await client.query(
          `SELECT account_id, debit_amount, credit_amount, party_id, description 
           FROM journal_entry_lines WHERE journal_entry_id = $1 ORDER BY line_number ASC`,
          [origJe.id]
        );

        const revLines = linesRes.rows.map((l) => ({
          account_id: l.account_id,
          debit_amount: Number(l.credit_amount), // Swap debit and credit
          credit_amount: Number(l.debit_amount),
          party_id: l.party_id,
          description: `Reversal: ${l.description || 'Payment reversal'}`,
        }));

        const revEntryNumber = await accountingRepository.generateEntryNumber(new Date(), client);

        const revJeRes = await client.query(
          `INSERT INTO journal_entries (
            entry_number, entry_date, accounting_date, source_type, source_id, source_reference,
            narration, total_debit, total_credit, status, posted_at, posted_by, reversal_reason
          ) VALUES ($1, CURRENT_DATE, CURRENT_DATE, 'SUPPLIER_PAYMENT_REVERSAL', $2, $3, $4, $5, $6, 'posted', NOW(), $7, $8)
          RETURNING id`,
          [
            revEntryNumber,
            paymentId,
            payment.payment_number,
            `Reversal of supplier payment ${payment.payment_number}: ${data.reversal_reason}`,
            origJe.total_credit,
            origJe.total_debit,
            user.id,
            data.reversal_reason,
          ]
        );

        const revJeId = revJeRes.rows[0].id;
        for (let i = 0; i < revLines.length; i++) {
          await client.query(
            `INSERT INTO journal_entry_lines (
              journal_entry_id, account_id, line_number, debit_amount, credit_amount, description, party_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              revJeId,
              revLines[i].account_id,
              i + 1,
              revLines[i].debit_amount,
              revLines[i].credit_amount,
              revLines[i].description,
              revLines[i].party_id,
            ]
          );
        }

        // Mark original entry as reversed and link reversal
        await client.query(
          `UPDATE journal_entries 
           SET status = 'reversed', reversed_at = NOW(), reversed_by = $1, reversal_entry_id = $2, reversal_reason = $3
           WHERE id = $4`,
          [user.id, revJeId, data.reversal_reason, origJe.id]
        );
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
