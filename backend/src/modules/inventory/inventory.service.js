import { inventoryRepository } from './inventory.repository.js';
import { itemsRepository } from '../items/items.repository.js';
import { unitsRepository } from '../units/units.repository.js';
import { ApiError } from '../../utils/ApiError.js';
import { getClient } from '../../config/db.js';
import { accountingService } from '../accounting/accounting.service.js';

export const inventoryService = {
  /**
   * Get current stock balance across all items
   */
  async getCurrentStock(queryParams) {
    return await inventoryRepository.findCurrentStock(queryParams);
  },

  /**
   * Get stock balance for a specific item
   */
  async getItemStock(itemId) {
    const item = await itemsRepository.findById(itemId);
    if (!item) {
      throw ApiError.notFound(`Item with ID '${itemId}' not found`);
    }

    const stock = await inventoryRepository.findStockByItemId(itemId);
    if (!stock) {
      return {
        item_id: item.id,
        sku: item.sku,
        item_name: item.name,
        item_type: item.item_type,
        base_uom_id: item.base_uom_id,
        packets_per_carton: item.packets_per_carton,
        closing_stock_base_qty: 0,
        equivalent_cartons: null,
        current_moving_wac: parseFloat(item.standard_purchase_rate || 0),
        total_stock_valuation: 0,
        min_reorder_level: parseFloat(item.min_reorder_level || 0),
        is_low_stock_alert: true,
        last_transaction_timestamp: null,
      };
    }

    return stock;
  },

  /**
   * Get items with low stock alerts
   */
  async getLowStock() {
    return await inventoryRepository.findLowStock();
  },

  /**
   * Get inventory valuation summary
   */
  async getValuation() {
    return await inventoryRepository.findValuationSummary();
  },

  /**
   * Get stock ledger movement register
   */
  async getLedger(queryParams) {
    return await inventoryRepository.findStockLedger(queryParams);
  },

  /**
   * Check material availability against current inventory balances
   */
  async checkAvailability(items) {
    const availabilityResults = [];
    let allSufficient = true;

    for (const req of items) {
      const itemRecord = await itemsRepository.findById(req.item_id);
      if (!itemRecord) {
        throw ApiError.notFound(`Item with ID '${req.item_id}' not found`);
      }

      // Convert required quantity to item's base UOM
      let requiredBaseQty;
      try {
        requiredBaseQty = await unitsRepository.computeBaseQuantity(
          req.item_id,
          req.required_qty,
          req.uom_id
        );
      } catch (err) {
        throw ApiError.badRequest(
          `UOM '${req.uom_id}' is incompatible with item '${itemRecord.sku}' base UOM '${itemRecord.base_uom_id}': ${err.message}`
        );
      }

      const stock = await inventoryRepository.findStockByItemId(req.item_id);
      const availableBaseQty = stock ? parseFloat(stock.closing_stock_base_qty) : 0.0000;
      const isSufficient = availableBaseQty >= requiredBaseQty;

      if (!isSufficient) {
        allSufficient = false;
      }

      const shortfall = isSufficient ? 0.0000 : Math.round((requiredBaseQty - availableBaseQty) * 10000) / 10000;

      availabilityResults.push({
        item_id: req.item_id,
        sku: itemRecord.sku,
        name: itemRecord.name,
        item_type: itemRecord.item_type,
        base_uom_id: itemRecord.base_uom_id,
        requested_qty: req.required_qty,
        requested_uom_id: req.uom_id,
        required_base_qty: requiredBaseQty,
        available_base_qty: availableBaseQty,
        shortfall_base_qty: shortfall,
        is_sufficient: isSufficient,
        current_moving_wac: stock ? parseFloat(stock.current_moving_wac) : parseFloat(itemRecord.standard_purchase_rate || 0),
      });
    }

    return {
      all_sufficient: allSufficient,
      items: availabilityResults,
    };
  },

  /**
   * Create stock adjustment
   */
  async createStockAdjustment(data, user) {
    const item = await itemsRepository.findById(data.item_id);
    if (!item) {
      throw ApiError.notFound(`Item with ID ${data.item_id} not found`);
    }

    const adjustmentNumber = await inventoryRepository.generateAdjustmentNumber(data.adjustment_date);
    return inventoryRepository.createStockAdjustment({
      ...data,
      adjustment_number: adjustmentNumber,
      authorized_by: user.id,
      status: 'draft',
    });
  },

  /**
   * Post stock adjustment and integrate with double-entry accounting
   */
  async postStockAdjustment(id, user) {
    const adj = await inventoryRepository.findAdjustmentById(id);
    if (!adj) {
      throw ApiError.notFound(`Stock adjustment with ID ${id} not found`);
    }

    if (adj.status === 'posted') {
      throw ApiError.badRequest(`Stock adjustment ${adj.adjustment_number} is already posted`);
    }

    const updatedAdj = await inventoryRepository.postStockAdjustment(id, user.id);

    // Accounting Integration
    try {
      const delta = Number(updatedAdj.discrepancy_quantity);
      const totalCost = Math.abs(Number(updatedAdj.total_cost));

      if (totalCost > 0) {
        const isFg = updatedAdj.item_type === 'finished_good';
        const invAccountCode = isFg ? '1330' : '1310'; // 1330 FG, 1310 Raw Materials

        let lines;
        let narration;

        if (delta < 0) {
          // Write-off / Loss: DR Loss Expense, CR Inventory
          lines = [
            {
              account_code: '6450', // Inventory Write-Off & Stock Loss
              debit_amount: totalCost,
              credit_amount: 0,
              description: `Stock adjustment write-off: ${updatedAdj.adjustment_number} (${updatedAdj.reason || 'Inventory Loss'})`,
            },
            {
              account_code: invAccountCode,
              debit_amount: 0,
              credit_amount: totalCost,
              description: `Inventory reduction for ${updatedAdj.item_name} (${updatedAdj.adjustment_number})`,
            },
          ];
          narration = `Stock Write-Off: ${updatedAdj.adjustment_number} (${updatedAdj.reason || 'Adjustment'})`;
        } else {
          // Gain / Surplus: DR Inventory, CR Other Operating Income
          lines = [
            {
              account_code: invAccountCode,
              debit_amount: totalCost,
              credit_amount: 0,
              description: `Inventory surplus for ${updatedAdj.item_name} (${updatedAdj.adjustment_number})`,
            },
            {
              account_code: '4200', // Other Operating Income
              debit_amount: 0,
              credit_amount: totalCost,
              description: `Surplus adjustment income: ${updatedAdj.adjustment_number}`,
            },
          ];
          narration = `Stock Surplus Gain: ${updatedAdj.adjustment_number} (${updatedAdj.reason || 'Adjustment'})`;
        }

        const entryDate = updatedAdj.adjustment_date
          ? new Date(updatedAdj.adjustment_date).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        await accountingService.createJournalEntry(
          {
            entry_date: entryDate,
            source_type: 'STOCK_ADJUSTMENT',
            source_id: updatedAdj.id,
            source_reference: updatedAdj.adjustment_number,
            narration,
            post_immediately: true,
            lines,
          },
          user
        );
      }
    } catch (err) {
      console.error('Accounting integration error on stock adjustment:', err.message);
    }

    return updatedAdj;
  },

  async getAdjustments(filters = {}) {
    return inventoryRepository.findAdjustments(filters);
  },

  async getAdjustmentById(id) {
    const adj = await inventoryRepository.findAdjustmentById(id);
    if (!adj) {
      throw ApiError.notFound(`Stock adjustment with ID ${id} not found`);
    }
    return adj;
  },

  async getDiscrepancies() {
    return inventoryRepository.findDiscrepancies();
  },
};
