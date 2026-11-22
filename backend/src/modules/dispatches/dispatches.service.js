import { dispatchesRepository } from './dispatches.repository.js';
import { invoicesRepository } from '../invoices/invoices.repository.js';
import { DISPATCH_STATUS } from './dispatches.constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { query } from '../../config/db.js';

export const dispatchesService = {
  /**
   * Prepare a new dispatch note for a posted tax invoice
   */
  async createDispatch(dispatchData, user) {
    // 1. Fetch and validate invoice
    const invoice = await invoicesRepository.findById(dispatchData.invoiceId);
    if (!invoice) {
      throw ApiError.notFound('Invoice not found');
    }

    if (invoice.status !== 'posted') {
      throw ApiError.badRequest(
        `Invoice ${invoice.invoice_number} cannot be dispatched. Only posted invoices can be prepared for dispatch (current status: "${invoice.status}").`
      );
    }

    // 2. Prevent duplicate dispatches for the same invoice
    const existingDispatch = await dispatchesRepository.findByInvoiceId(invoice.id);
    if (existingDispatch) {
      throw ApiError.badRequest(
        `Duplicate Dispatch Error: A dispatch note (${existingDispatch.dispatch_number}) already exists for invoice ${invoice.invoice_number}.`
      );
    }

    // 3. Over-dispatch validation & base quantity computation
    const invoiceItemMap = new Map();
    invoice.items.forEach((ii) => invoiceItemMap.set(ii.item_id, ii));

    const validatedItems = [];

    for (const itemInput of dispatchData.items) {
      const invoiceItem = invoiceItemMap.get(itemInput.itemId);
      if (!invoiceItem) {
        throw ApiError.badRequest(`Item ${itemInput.itemId} does not belong to invoice ${invoice.invoice_number}`);
      }

      const dispatchedQty = Number(itemInput.dispatchedQty);
      const invoicedQty = Number(invoiceItem.quantity);

      if (dispatchedQty > invoicedQty) {
        throw ApiError.badRequest(
          `Over-Dispatch Prevention: Dispatched quantity (${dispatchedQty}) exceeds invoiced quantity (${invoicedQty}) for item "${invoiceItem.item_name_snapshot}".`
        );
      }

      const uomId = itemInput.uomId || invoiceItem.uom_id;

      // Compute exact base quantity via database function
      const baseQtyRes = await query(
        `SELECT fn_compute_base_quantity($1, $2, $3) AS base_qty;`,
        [itemInput.itemId, dispatchedQty, uomId]
      );
      const baseQuantity = Number(baseQtyRes.rows[0].base_qty);

      validatedItems.push({
        item_id: itemInput.itemId,
        batch_number: itemInput.batchNumber,
        dispatched_qty: dispatchedQty,
        uom_id: uomId,
        base_quantity: baseQuantity,
      });
    }

    const dispatchDate = dispatchData.dispatchDate || new Date().toISOString().split('T')[0];
    const dispatchNumber = await dispatchesRepository.generateDispatchNumber(dispatchDate);

    return dispatchesRepository.createWithItems(
      {
        dispatch_number: dispatchNumber,
        invoice_id: invoice.id,
        dispatch_date: dispatchDate,
        carrier_or_vehicle_no: dispatchData.carrierOrVehicleNo || null,
        driver_name: dispatchData.driverName || null,
        status: DISPATCH_STATUS.READY,
        dispatched_by: user.id,
      },
      validatedItems
    );
  },

  /**
   * Post sales dispatch: Atomically deduct finished goods inventory at Moving WAC
   */
  async postDispatch(id, user) {
    const dispatch = await dispatchesRepository.findById(id);
    if (!dispatch) {
      throw ApiError.notFound('Dispatch not found');
    }

    if (dispatch.status !== DISPATCH_STATUS.READY) {
      throw ApiError.badRequest(
        `Duplicate Posting Error: Dispatch ${dispatch.dispatch_number} is already in status "${dispatch.status}".`
      );
    }

    try {
      await dispatchesRepository.executePostingEngine(id, user.id);
    } catch (err) {
      // Re-throw database business constraint violations cleanly
      if (err.message && err.message.includes('Negative Inventory Prevention')) {
        throw ApiError.badRequest(err.message);
      }
      if (err.message && err.message.includes('UOM Conversion Error')) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    }

    return dispatchesRepository.findById(id);
  },

  /**
   * Confirm goods delivery to customer
   */
  async deliverDispatch(id, deliveryData, user) {
    const dispatch = await dispatchesRepository.findById(id);
    if (!dispatch) {
      throw ApiError.notFound('Dispatch not found');
    }

    if (dispatch.status !== DISPATCH_STATUS.DISPATCHED) {
      throw ApiError.badRequest(
        `Cannot mark dispatch ${dispatch.dispatch_number} as delivered. Current status is "${dispatch.status}". Dispatch must be posted before delivery.`
      );
    }

    await dispatchesRepository.updateStatus(id, DISPATCH_STATUS.DELIVERED);
    return dispatchesRepository.findById(id);
  },

  /**
   * Get COGS, gross margin, and inventory valuation for dispatch
   */
  async getCogsAndMargin(id) {
    const dispatch = await dispatchesRepository.findById(id);
    if (!dispatch) {
      throw ApiError.notFound('Dispatch not found');
    }

    const cogsData = await dispatchesRepository.getCogsAndMargin(id);
    return cogsData;
  },

  /**
   * List dispatches with pagination
   */
  async getDispatches(filters) {
    return dispatchesRepository.findAll(filters);
  },

  /**
   * Get dispatch by ID
   */
  async getDispatchById(id) {
    const dispatch = await dispatchesRepository.findById(id);
    if (!dispatch) {
      throw ApiError.notFound('Dispatch not found');
    }
    return dispatch;
  },
};
