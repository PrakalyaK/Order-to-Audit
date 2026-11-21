import { inventoryRepository } from './inventory.repository.js';
import { itemsRepository } from '../items/items.repository.js';
import { unitsRepository } from '../units/units.repository.js';
import { ApiError } from '../../utils/ApiError.js';

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
};
