import { invoicesRepository } from './invoices.repository.js';
import { salesOrdersRepository } from '../sales-orders/sales-orders.repository.js';
import { INVOICE_STATUS, getFinancialYear } from './invoices.constants.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { query } from '../../config/db.js';

export const invoicesService = {
  /**
   * Generate statutory GST Tax Invoice from an approved sales order
   */
  async createInvoice(invoiceData, user) {
    // 1. Fetch sales order
    const order = await salesOrdersRepository.findById(invoiceData.salesOrderId);
    if (!order) {
      throw ApiError.notFound('Sales order not found');
    }

    if (order.status !== 'approved') {
      throw ApiError.badRequest(
        `Sales order ${order.order_number} cannot be invoiced. Only approved sales orders can be invoiced (current status: "${order.status}").`
      );
    }

    // 2. Prevent duplicate active invoices for the same sales order
    const existingInvoice = await invoicesRepository.findBySalesOrderId(order.id);
    if (existingInvoice) {
      throw ApiError.badRequest(
        `Duplicate Invoice Error: An active invoice (${existingInvoice.invoice_number}) already exists for sales order ${order.order_number}.`
      );
    }

    // 3. Resolve customer and place of supply
    const partyRes = await query(`SELECT * FROM parties WHERE id = $1;`, [order.customer_id]);
    if (partyRes.rows.length === 0) {
      throw ApiError.notFound('Customer party not found');
    }
    const customer = partyRes.rows[0];

    const factoryStateCode = env.factoryStateCode || '33';
    const placeOfSupply = invoiceData.placeOfSupplyStateCode || customer.state_code;
    const isInterstate = placeOfSupply !== factoryStateCode;

    // 4. Financial year and invoice numbering
    const invoiceDate = invoiceData.invoiceDate || new Date().toISOString().split('T')[0];
    const financialYear = getFinancialYear(invoiceDate);
    const invoiceNumber = await invoicesRepository.generateInvoiceNumber(financialYear);

    // 5. Build invoice line items with statutory GST splits
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    const validatedItems = [];

    for (const orderItem of order.items) {
      const qty = Number(orderItem.approved_qty ?? orderItem.ordered_qty);
      if (qty <= 0) continue;

      // Compute exact base quantity using DB posting engine function
      const baseQtyRes = await query(
        `SELECT fn_compute_base_quantity($1, $2, $3) AS base_qty;`,
        [orderItem.item_id, qty, orderItem.uom_id]
      );
      const baseQuantity = Number(baseQtyRes.rows[0].base_qty);

      const unitPrice = Number(orderItem.unit_price);
      const taxableValue = Math.round(qty * unitPrice * 100) / 100;
      const gstRate = Number(orderItem.gst_rate_pct);

      let cgstRate = 0;
      let cgstAmount = 0;
      let sgstRate = 0;
      let sgstAmount = 0;
      let igstRate = 0;
      let igstAmount = 0;

      if (!isInterstate) {
        // Intra-state: 50% CGST + 50% SGST
        cgstRate = Math.round((gstRate / 2) * 100) / 100;
        sgstRate = Math.round((gstRate / 2) * 100) / 100;
        cgstAmount = Math.round(taxableValue * (cgstRate / 100) * 100) / 100;
        sgstAmount = Math.round(taxableValue * (sgstRate / 100) * 100) / 100;
      } else {
        // Interstate: 100% IGST
        igstRate = gstRate;
        igstAmount = Math.round(taxableValue * (igstRate / 100) * 100) / 100;
      }

      const totalItemValue = Math.round((taxableValue + cgstAmount + sgstAmount + igstAmount) * 100) / 100;

      totalTaxable += taxableValue;
      totalCgst += cgstAmount;
      totalSgst += sgstAmount;
      totalIgst += igstAmount;

      validatedItems.push({
        item_id: orderItem.item_id,
        item_name_snapshot: orderItem.item_name_snapshot,
        hsn_code_snapshot: orderItem.hsn_code_snapshot,
        quantity: qty,
        uom_id: orderItem.uom_id,
        base_quantity: baseQuantity,
        unit_price: unitPrice,
        taxable_value: taxableValue,
        gst_rate_pct: gstRate,
        cgst_rate_pct: cgstRate,
        cgst_amount: cgstAmount,
        sgst_rate_pct: sgstRate,
        sgst_amount: sgstAmount,
        igst_rate_pct: igstRate,
        igst_amount: igstAmount,
        total_item_value: totalItemValue,
      });
    }

    if (validatedItems.length === 0) {
      throw ApiError.badRequest('No items with approved quantity greater than zero found to invoice');
    }

    totalTaxable = Math.round(totalTaxable * 100) / 100;
    totalCgst = Math.round(totalCgst * 100) / 100;
    totalSgst = Math.round(totalSgst * 100) / 100;
    totalIgst = Math.round(totalIgst * 100) / 100;
    const totalInvoiceValue = Math.round((totalTaxable + totalCgst + totalSgst + totalIgst) * 100) / 100;

    return invoicesRepository.createWithItems(
      {
        invoice_number: invoiceNumber,
        financial_year: financialYear,
        sales_order_id: order.id,
        customer_id: customer.id,
        invoice_date: invoiceDate,
        place_of_supply_state_code: placeOfSupply,
        is_interstate: isInterstate,
        taxable_value: totalTaxable,
        cgst_amount: totalCgst,
        sgst_amount: totalSgst,
        igst_amount: totalIgst,
        total_invoice_value: totalInvoiceValue,
        status: invoiceData.status || INVOICE_STATUS.POSTED,
        approved_by: user.id,
      },
      validatedItems
    );
  },

  /**
   * Get paginated invoices
   */
  async getInvoices(filters) {
    return invoicesRepository.findAll(filters);
  },

  /**
   * Get invoice by ID
   */
  async getInvoiceById(id) {
    const invoice = await invoicesRepository.findById(id);
    if (!invoice) {
      throw ApiError.notFound('Invoice not found');
    }
    return invoice;
  },

  /**
   * Cancel invoice (only if not dispatched)
   */
  async cancelInvoice(id, user) {
    const invoice = await invoicesRepository.findById(id);
    if (!invoice) {
      throw ApiError.notFound('Invoice not found');
    }

    if (invoice.status === INVOICE_STATUS.DISPATCHED) {
      throw ApiError.badRequest(
        `Statutory Audit Violation: Cannot cancel dispatched invoice ${invoice.invoice_number}. Commercial dispatch and stock movements have already been posted. Corrections must be handled via Credit Note.`
      );
    }

    if (invoice.status === INVOICE_STATUS.CANCELLED) {
      throw ApiError.badRequest('Invoice is already cancelled');
    }

    // Cancel invoice and revert sales order to 'approved'
    await invoicesRepository.updateStatus(id, INVOICE_STATUS.CANCELLED);
    await query(`UPDATE sales_orders SET status = 'approved', updated_at = NOW() WHERE id = $1;`, [
      invoice.sales_order_id,
    ]);

    return invoicesRepository.findById(id);
  },

  /**
   * Get GST Outward Supplies Register report
   */
  async getGstOutwardSummary(query) {
    return invoicesRepository.getGstOutwardSummary(query);
  },

  /**
   * Get Customer Receivables & Outstanding report
   */
  async getCustomerOutstanding(query) {
    return invoicesRepository.getCustomerOutstanding(query);
  },

  /**
   * Get Invoice Balances & Allocations report
   */
  async getInvoiceBalances(query) {
    return invoicesRepository.getInvoiceBalances(query);
  },
};
