import { purchasesRepository } from './purchases.repository.js';
import { partiesRepository } from '../parties/parties.repository.js';
import { itemsRepository } from '../items/items.repository.js';
import { unitsRepository } from '../units/units.repository.js';
import { ApiError } from '../../utils/ApiError.js';
import { ITEM_TYPES } from '../items/items.constants.js';

const FACTORY_STATE_CODE = '33'; // Tamil Nadu

export const purchasesService = {
  /**
   * Get paginated purchases list
   */
  async getPurchases(queryParams) {
    return await purchasesRepository.findAll(queryParams);
  },

  /**
   * Get purchase details by ID
   */
  async getPurchaseById(id) {
    const purchase = await purchasesRepository.findById(id);
    if (!purchase) {
      throw ApiError.notFound(`Purchase bill with ID '${id}' not found`);
    }
    return purchase;
  },

  /**
   * Validate line items, compute base quantities and line totals
   */
  async _validateAndCalculateItems(items, supplierStateCode) {
    const validatedItems = [];
    let subtotalAmount = 0;
    let totalTaxAmount = 0;

    for (const item of items) {
      // 1. Verify item exists
      const itemRecord = await itemsRepository.findById(item.item_id);
      if (!itemRecord) {
        throw ApiError.notFound(`Item with ID '${item.item_id}' not found`);
      }

      // 2. Purchased item cannot be a finished_good (finished goods are produced via production runs)
      if (itemRecord.item_type === ITEM_TYPES.FINISHED_GOOD) {
        throw ApiError.badRequest(
          `Item '${itemRecord.sku}' is a finished_good. Only raw_material, packaging, or work_in_progress items can be purchased.`
        );
      }

      if (!itemRecord.is_active) {
        throw ApiError.badRequest(`Item '${itemRecord.sku}' is inactive`);
      }

      // 3. Verify UOM and compute base quantity
      const uomRecord = await unitsRepository.findById(item.uom_id);
      if (!uomRecord) {
        throw ApiError.badRequest(`Unit of measure '${item.uom_id}' does not exist`);
      }

      let baseQuantity;
      try {
        baseQuantity = await unitsRepository.computeBaseQuantity(item.item_id, item.quantity, item.uom_id);
      } catch (err) {
        throw ApiError.badRequest(
          `UOM '${item.uom_id}' is incompatible with item '${itemRecord.sku}' base UOM '${itemRecord.base_uom_id}': ${err.message}`
        );
      }

      if (baseQuantity <= 0) {
        throw ApiError.badRequest(`Computed base quantity for item '${itemRecord.sku}' must be greater than 0`);
      }

      // 4. Calculations: taxable amount and GST
      const taxableAmount = Math.round(item.quantity * item.unit_rate * 100) / 100;
      const gstRatePct = parseFloat(itemRecord.gst_rate_pct || 0);
      const taxAmount = Math.round(taxableAmount * (gstRatePct / 100) * 100) / 100;
      const totalAmount = Math.round((taxableAmount + taxAmount) * 100) / 100;

      subtotalAmount += taxableAmount;
      totalTaxAmount += taxAmount;

      validatedItems.push({
        item_id: item.item_id,
        supplier_batch_no: item.supplier_batch_no || null,
        expiry_date: item.expiry_date || null,
        quantity: item.quantity,
        uom_id: item.uom_id,
        base_quantity: baseQuantity,
        unit_rate: item.unit_rate,
        taxable_amount: taxableAmount,
        gst_rate_pct: gstRatePct,
        tax_amount: taxAmount,
        total_amount: totalAmount,
      });
    }

    subtotalAmount = Math.round(subtotalAmount * 100) / 100;
    totalTaxAmount = Math.round(totalTaxAmount * 100) / 100;

    // 5. Tax split: Intrastate (CGST + SGST) vs Interstate (IGST)
    let cgstAmount = 0.00;
    let sgstAmount = 0.00;
    let igstAmount = 0.00;

    if (supplierStateCode === FACTORY_STATE_CODE) {
      cgstAmount = Math.round((totalTaxAmount / 2) * 100) / 100;
      sgstAmount = Math.round((totalTaxAmount - cgstAmount) * 100) / 100;
    } else {
      igstAmount = totalTaxAmount;
    }

    const totalAmount = Math.round((subtotalAmount + cgstAmount + sgstAmount + igstAmount) * 100) / 100;

    return {
      items: validatedItems,
      subtotal_amount: subtotalAmount,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      igst_amount: igstAmount,
      total_amount: totalAmount,
    };
  },

  /**
   * Create a new purchase bill in draft status
   */
  async createPurchase(data, userId) {
    const { supplier_id, bill_number, bill_date, notes, items } = data;

    // 1. Verify supplier party
    const supplier = await partiesRepository.findById(supplier_id);
    if (!supplier) {
      throw ApiError.notFound(`Supplier with ID '${supplier_id}' not found`);
    }
    if (!['supplier', 'both'].includes(supplier.party_type)) {
      throw ApiError.badRequest(
        `Party '${supplier.trade_name}' is registered as '${supplier.party_type}', not a supplier`
      );
    }
    if (!supplier.is_active) {
      throw ApiError.badRequest(`Supplier '${supplier.trade_name}' is inactive`);
    }

    // 2. Check duplicate bill number for this supplier
    const existing = await purchasesRepository.findBySupplierAndBillNumber(supplier_id, bill_number);
    if (existing) {
      throw ApiError.conflict(
        `Purchase bill '${bill_number}' already exists for supplier '${supplier.trade_name}'`
      );
    }

    // 3. Process line items and compute header totals
    const itemCalculations = await this._validateAndCalculateItems(items, supplier.state_code);

    const billHeader = {
      supplier_id,
      bill_number,
      bill_date,
      subtotal_amount: itemCalculations.subtotal_amount,
      cgst_amount: itemCalculations.cgst_amount,
      sgst_amount: itemCalculations.sgst_amount,
      igst_amount: itemCalculations.igst_amount,
      total_amount: itemCalculations.total_amount,
      status: 'draft',
      received_by: userId,
      notes: notes || null,
    };

    const created = await purchasesRepository.createWithItems(billHeader, itemCalculations.items);
    return await purchasesRepository.findById(created.id);
  },

  /**
   * Update an unposted draft purchase bill
   */
  async updatePurchase(id, updateData, userId) {
    const existing = await purchasesRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Purchase bill with ID '${id}' not found`);
    }

    if (existing.status !== 'draft') {
      throw ApiError.badRequest(
        `Cannot modify purchase bill '${existing.bill_number}' in status '${existing.status}'. Only draft purchases can be edited.`
      );
    }

    const { items, ...headerUpdates } = updateData;
    let recalculatedTotals = {};

    // Check duplicate bill_number if changed
    if (headerUpdates.bill_number && headerUpdates.bill_number !== existing.bill_number) {
      const dup = await purchasesRepository.findBySupplierAndBillNumber(existing.supplier_id, headerUpdates.bill_number);
      if (dup && dup.id !== id) {
        throw ApiError.conflict(`Purchase bill '${headerUpdates.bill_number}' already exists for this supplier`);
      }
    }

    let validatedItems;
    if (items && items.length > 0) {
      const supplier = await partiesRepository.findById(existing.supplier_id);
      const calc = await this._validateAndCalculateItems(items, supplier.state_code);
      validatedItems = calc.items;
      recalculatedTotals = {
        subtotal_amount: calc.subtotal_amount,
        cgst_amount: calc.cgst_amount,
        sgst_amount: calc.sgst_amount,
        igst_amount: calc.igst_amount,
        total_amount: calc.total_amount,
      };
    }

    const finalHeader = {
      ...headerUpdates,
      ...recalculatedTotals,
    };

    await purchasesRepository.updateWithItems(id, finalHeader, validatedItems);
    return await purchasesRepository.findById(id);
  },

  /**
   * Post purchase receipt to inventory atomically
   */
  async receivePurchase(id, userId) {
    const existing = await purchasesRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Purchase bill with ID '${id}' not found`);
    }

    if (existing.status !== 'draft') {
      throw ApiError.badRequest(
        `Duplicate Posting Error: Purchase bill '${existing.bill_number}' is already in status '${existing.status}'. Only draft bills can be received.`
      );
    }

    if (!existing.items || existing.items.length === 0) {
      throw ApiError.badRequest(`Purchase bill '${existing.bill_number}' has no line items to receive`);
    }

    // Call PostgreSQL atomic posting function
    await purchasesRepository.postPurchaseReceipt(id, userId);

    return await purchasesRepository.findById(id);
  },

  /**
   * Cancel an unposted draft purchase bill
   */
  async cancelPurchase(id, userId) {
    const existing = await purchasesRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Purchase bill with ID '${id}' not found`);
    }

    if (existing.status !== 'draft') {
      throw ApiError.badRequest(
        `Cannot cancel purchase bill '${existing.bill_number}' in status '${existing.status}'. Only draft bills can be cancelled.`
      );
    }

    await purchasesRepository.updateStatus(id, 'cancelled');
    return await purchasesRepository.findById(id);
  },
};
