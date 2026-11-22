import { paymentsRepository } from './payments.repository.js';
import { PAYMENT_STATUS, roundMoney } from './payments.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { query, getClient } from '../../config/db.js';

export const paymentsService = {
  /**
   * Record a new customer payment (draft or posted, with optional initial allocations)
   */
  async createPayment(data, user) {
    // 1. Validate Customer
    const partyRes = await query(
      `SELECT id, trade_name, party_type, is_active FROM parties WHERE id = $1;`,
      [data.customerId]
    );

    if (partyRes.rows.length === 0) {
      throw ApiError.notFound(`Customer party with ID "${data.customerId}" not found`);
    }

    const customer = partyRes.rows[0];
    if (!['customer', 'both'].includes(customer.party_type)) {
      throw ApiError.badRequest(
        `Invalid Party Type: Party "${customer.trade_name}" is a "${customer.party_type}", not a customer. Payments can only be recorded for customer parties.`
      );
    }

    if (!customer.is_active) {
      throw ApiError.badRequest(`Customer "${customer.trade_name}" is inactive.`);
    }

    const paymentDate = data.paymentDate || new Date().toISOString().split('T')[0];
    const totalAmount = roundMoney(data.totalAmount);
    const status = data.status || PAYMENT_STATUS.POSTED;

    // 2. Draft payments cannot have allocations immediately
    if (status === PAYMENT_STATUS.DRAFT && data.allocations && data.allocations.length > 0) {
      throw ApiError.badRequest('Draft payments cannot have invoice allocations before being posted.');
    }

    // 3. Validate initial allocations if provided
    if (data.allocations && data.allocations.length > 0) {
      let totalAllocated = 0;
      for (const alloc of data.allocations) {
        totalAllocated = roundMoney(totalAllocated + Number(alloc.amount));
      }
      if (totalAllocated > totalAmount) {
        throw ApiError.badRequest(
          `Over-allocation Error: Total allocated amount (₹${totalAllocated}) exceeds total payment amount (₹${totalAmount}).`
        );
      }
    }

    // 4. Transactional creation and allocation
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const receiptNumber = await paymentsRepository.generateReceiptNumber(paymentDate, client);

      const createdPayment = await paymentsRepository.create(
        {
          receipt_number: receiptNumber,
          customer_id: customer.id,
          payment_date: paymentDate,
          total_amount: totalAmount,
          payment_mode: data.paymentMode,
          reference_txn_id: data.referenceTxnId,
          bank_name: data.bankName,
          bank_branch: data.bankBranch,
          cheque_number: data.chequeNumber,
          cheque_date: data.chequeDate,
          notes: data.notes,
          status,
          recorded_by: user.id,
        },
        client
      );

      // Apply initial allocations if payment is posted
      if (status === PAYMENT_STATUS.POSTED && data.allocations && data.allocations.length > 0) {
        for (const alloc of data.allocations) {
          await paymentsRepository.allocate(
            createdPayment.id,
            alloc.invoiceId,
            roundMoney(alloc.amount),
            user.id,
            client
          );
        }
      }

      await client.query('COMMIT');

      // Return full payment record with customer and allocations
      return await paymentsRepository.findById(createdPayment.id);
    } catch (err) {
      await client.query('ROLLBACK');
      // Surface DB constraint/exception messages nicely
      if (err.message && err.message.includes('Over-allocation Error')) {
        throw ApiError.badRequest(err.message);
      }
      if (err.message && err.message.includes('Invoice Overpayment')) {
        throw ApiError.badRequest(err.message);
      }
      if (err.message && err.message.includes('Customer Mismatch')) {
        throw ApiError.badRequest(err.message);
      }
      if (err.message && err.message.includes('Allocation Error')) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Update draft payment details
   */
  async updateDraftPayment(id, data, user) {
    const existing = await paymentsRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Payment with ID "${id}" not found`);
    }

    if (existing.status !== PAYMENT_STATUS.DRAFT) {
      throw ApiError.badRequest(
        `Cannot update payment in status "${existing.status}". Only draft payments can be modified.`
      );
    }

    const updateData = {};
    if (data.paymentDate) updateData.payment_date = data.paymentDate;
    if (data.totalAmount) updateData.total_amount = roundMoney(data.totalAmount);
    if (data.paymentMode) updateData.payment_mode = data.paymentMode;
    if (data.referenceTxnId !== undefined) updateData.reference_txn_id = data.referenceTxnId;
    if (data.bankName !== undefined) updateData.bank_name = data.bankName;
    if (data.bankBranch !== undefined) updateData.bank_branch = data.bankBranch;
    if (data.chequeNumber !== undefined) updateData.cheque_number = data.chequeNumber;
    if (data.chequeDate !== undefined) updateData.cheque_date = data.chequeDate;
    if (data.notes !== undefined) updateData.notes = data.notes;

    await paymentsRepository.updateDraft(id, updateData);
    return await paymentsRepository.findById(id);
  },

  /**
   * Transition draft payment to posted with optional allocations
   */
  async postPayment(id, postData = {}, user) {
    const existing = await paymentsRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Payment with ID "${id}" not found`);
    }

    if (existing.status === PAYMENT_STATUS.POSTED) {
      throw ApiError.badRequest(`Payment "${existing.receipt_number}" is already posted.`);
    }

    if (existing.status !== PAYMENT_STATUS.DRAFT) {
      throw ApiError.badRequest(
        `Cannot post payment in status "${existing.status}". Only draft payments can be posted.`
      );
    }

    const allocations = postData.allocations || [];
    if (allocations.length > 0) {
      let totalAlloc = 0;
      for (const a of allocations) {
        totalAlloc = roundMoney(totalAlloc + Number(a.amount));
      }
      if (totalAlloc > Number(existing.total_amount)) {
        throw ApiError.badRequest(
          `Over-allocation Error: Total allocation (₹${totalAlloc}) exceeds payment total (₹${existing.total_amount}).`
        );
      }
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await paymentsRepository.updateStatusToPosted(id, client);

      if (allocations.length > 0) {
        for (const alloc of allocations) {
          await paymentsRepository.allocate(
            id,
            alloc.invoiceId,
            roundMoney(alloc.amount),
            user.id,
            client
          );
        }
      }

      await client.query('COMMIT');
      return await paymentsRepository.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.message && (err.message.includes('Over-allocation') || err.message.includes('Invoice Overpayment') || err.message.includes('Customer Mismatch') || err.message.includes('Allocation Error'))) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Cancel draft payment
   */
  async cancelDraftPayment(id, user) {
    const existing = await paymentsRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Payment with ID "${id}" not found`);
    }

    if (existing.status !== PAYMENT_STATUS.DRAFT) {
      throw ApiError.badRequest(
        `Cannot cancel payment in status "${existing.status}". Only draft payments can be cancelled. Posted payments must be reversed.`
      );
    }

    await paymentsRepository.cancelDraft(id);
    return await paymentsRepository.findById(id);
  },

  /**
   * Allocate an existing posted payment across one or more invoices
   */
  async allocatePayment(id, allocationPayload, user) {
    const payment = await paymentsRepository.findById(id);
    if (!payment) {
      throw ApiError.notFound(`Payment with ID "${id}" not found`);
    }

    if (payment.status !== PAYMENT_STATUS.POSTED) {
      throw ApiError.badRequest(
        `Cannot allocate payment in status "${payment.status}". Only posted payments can be allocated.`
      );
    }

    // Normalize allocation payload to array
    let items = [];
    if (allocationPayload.allocations && Array.isArray(allocationPayload.allocations)) {
      items = allocationPayload.allocations;
    } else if (allocationPayload.invoiceId && allocationPayload.amount) {
      items = [{ invoiceId: allocationPayload.invoiceId, amount: allocationPayload.amount }];
    } else {
      throw ApiError.badRequest('Invalid allocation payload. Provide { invoiceId, amount } or { allocations: [...] }');
    }

    // Verify unallocated balance
    let totalToAllocate = 0;
    for (const item of items) {
      totalToAllocate = roundMoney(totalToAllocate + Number(item.amount));
    }

    if (totalToAllocate > Number(payment.unallocated_amount)) {
      throw ApiError.badRequest(
        `Over-allocation Error: Attempted allocation of ₹${totalToAllocate} exceeds available unallocated payment balance of ₹${payment.unallocated_amount}.`
      );
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      for (const item of items) {
        await paymentsRepository.allocate(
          payment.id,
          item.invoiceId,
          roundMoney(item.amount),
          user.id,
          client
        );
      }

      await client.query('COMMIT');
      return await paymentsRepository.findById(id);
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.message && (err.message.includes('Over-allocation') || err.message.includes('Invoice Overpayment') || err.message.includes('Customer Mismatch') || err.message.includes('Allocation Error'))) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Controlled workflow: Reverse posted payment and all its active allocations
   */
  async reversePayment(id, { reason }, user) {
    const payment = await paymentsRepository.findById(id);
    if (!payment) {
      throw ApiError.notFound(`Payment with ID "${id}" not found`);
    }

    if (payment.status === PAYMENT_STATUS.REVERSED) {
      throw ApiError.badRequest(`Payment "${payment.receipt_number}" has already been reversed.`);
    }

    if (payment.status !== PAYMENT_STATUS.POSTED) {
      throw ApiError.badRequest(
        `Cannot reverse payment in status "${payment.status}". Only posted payments can be reversed.`
      );
    }

    await paymentsRepository.reverse(id, user.id, reason);
    return await paymentsRepository.findById(id);
  },

  /**
   * Controlled workflow: Reverse a specific active allocation
   */
  async reverseAllocation(allocationId, { reason }, user) {
    const allocRes = await query(
      `SELECT * FROM payment_allocations WHERE id = $1;`,
      [allocationId]
    );

    if (allocRes.rows.length === 0) {
      throw ApiError.notFound(`Payment allocation with ID "${allocationId}" not found`);
    }

    const alloc = allocRes.rows[0];
    if (alloc.status === 'reversed') {
      throw ApiError.badRequest('This allocation has already been reversed.');
    }

    await paymentsRepository.unallocate(allocationId, user.id, reason);

    // Return the updated payment record
    return await paymentsRepository.findById(alloc.payment_id);
  },

  /**
   * Get single payment by ID
   */
  async getPaymentById(id) {
    const payment = await paymentsRepository.findById(id);
    if (!payment) {
      throw ApiError.notFound(`Payment with ID "${id}" not found`);
    }
    return payment;
  },

  /**
   * List payments with filtering & pagination
   */
  async getPayments(query) {
    return await paymentsRepository.findAll(query);
  },

  /**
   * Get payment history for a customer
   */
  async getCustomerPaymentHistory(customerId) {
    const partyRes = await query(`SELECT id, trade_name FROM parties WHERE id = $1;`, [customerId]);
    if (partyRes.rows.length === 0) {
      throw ApiError.notFound(`Customer with ID "${customerId}" not found`);
    }

    const history = await paymentsRepository.findCustomerPaymentHistory(customerId);
    const receivables = await paymentsRepository.findCustomerReceivables({ customerId, limit: 1 });

    return {
      customer: partyRes.rows[0],
      receivables: receivables.receivables[0] || null,
      ...history,
    };
  },

  /**
   * Get payment and allocation history for a specific invoice
   */
  async getInvoicePaymentHistory(invoiceId) {
    const invRes = await query(`SELECT * FROM v_invoice_balances WHERE invoice_id = $1;`, [invoiceId]);
    if (invRes.rows.length === 0) {
      throw ApiError.notFound(`Invoice with ID "${invoiceId}" not found`);
    }

    const allocations = await paymentsRepository.findAllocationsByInvoiceId(invoiceId);

    return {
      invoice: invRes.rows[0],
      allocations,
    };
  },

  /**
   * Customer receivables report
   */
  async getCustomerReceivables(query) {
    return await paymentsRepository.findCustomerReceivables(query);
  },

  /**
   * Invoice balances report
   */
  async getInvoiceBalances(query) {
    return await paymentsRepository.findInvoiceBalances(query);
  },

  /**
   * Receivables management summary dashboard
   */
  async getReceivablesSummary() {
    return await paymentsRepository.getReceivablesSummary();
  },
};
