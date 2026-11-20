import { itemsRepository } from './items.repository.js';
import { unitsRepository } from '../units/units.repository.js';
import { ApiError } from '../../utils/ApiError.js';

export const itemsService = {
  /**
   * Get paginated items with search & filters
   */
  async getItems(queryParams) {
    return await itemsRepository.findAll(queryParams);
  },

  /**
   * Get single item details by ID
   */
  async getItemById(id) {
    const item = await itemsRepository.findById(id);
    if (!item) {
      throw ApiError.notFound(`Item with ID '${id}' not found`);
    }
    return item;
  },

  /**
   * Create new item record
   */
  async createItem(itemData) {
    // 1. Check SKU uniqueness (case-insensitive)
    const existingSku = await itemsRepository.findBySku(itemData.sku);
    if (existingSku) {
      throw ApiError.conflict(`An item with SKU '${itemData.sku}' already exists`);
    }

    // 2. Validate base unit of measure exists
    const uom = await unitsRepository.findById(itemData.base_uom_id);
    if (!uom) {
      throw ApiError.badRequest(`Base unit of measure '${itemData.base_uom_id}' does not exist`);
    }

    return await itemsRepository.create(itemData);
  },

  /**
   * Update item details
   */
  async updateItem(id, updateData) {
    const existing = await itemsRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Item with ID '${id}' not found`);
    }

    // If updating SKU, check for conflict
    if (updateData.sku && updateData.sku.toUpperCase() !== existing.sku.toUpperCase()) {
      const duplicate = await itemsRepository.findBySku(updateData.sku);
      if (duplicate && duplicate.id !== id) {
        throw ApiError.conflict(`An item with SKU '${updateData.sku}' already exists`);
      }
    }

    // If updating base UOM, check existence
    if (updateData.base_uom_id) {
      const uom = await unitsRepository.findById(updateData.base_uom_id);
      if (!uom) {
        throw ApiError.badRequest(`Base unit of measure '${updateData.base_uom_id}' does not exist`);
      }
    }

    return await itemsRepository.update(id, updateData);
  },

  /**
   * Activate or deactivate an item
   */
  async setItemStatus(id, isActive) {
    const existing = await itemsRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Item with ID '${id}' not found`);
    }

    // Business rule: Check if item is in active BOMs before deactivating
    if (!isActive) {
      const activeBomCount = await itemsRepository.countActiveBomReferences(id);
      if (activeBomCount > 0) {
        throw ApiError.badRequest(
          `Cannot deactivate item '${existing.sku}'. It is currently referenced in ${activeBomCount} active BOM recipe(s). Please deactivate or update the BOM version first.`
        );
      }
    }

    return await itemsRepository.setStatus(id, isActive);
  },
};
