import { unitsRepository } from './units.repository.js';
import { ApiError } from '../../utils/ApiError.js';

export const unitsService = {
  /**
   * List all available units of measure
   */
  async getAllUnits() {
    return await unitsRepository.findAll();
  },

  /**
   * Get specific unit details by unit code ID
   * @param {string} id
   */
  async getUnitById(id) {
    const unit = await unitsRepository.findById(id.toUpperCase());
    if (!unit) {
      throw ApiError.notFound(`Unit of measure '${id}' not found`);
    }
    return unit;
  },

  /**
   * Create a new unit of measure respecting dimensional consistency
   * @param {object} unitData
   */
  async createUnit(unitData) {
    const existing = await unitsRepository.findById(unitData.id);
    if (existing) {
      throw ApiError.conflict(`Unit of measure with code '${unitData.id}' already exists`);
    }

    if (unitData.base_unit_id) {
      const baseUnit = await unitsRepository.findById(unitData.base_unit_id);
      if (!baseUnit) {
        throw ApiError.badRequest(`Referenced base unit '${unitData.base_unit_id}' does not exist`);
      }
      if (baseUnit.dimension !== unitData.dimension) {
        throw ApiError.badRequest(
          `Dimension mismatch: Cannot link unit with dimension '${unitData.dimension}' to base unit with dimension '${baseUnit.dimension}'`
        );
      }
    }

    return await unitsRepository.create(unitData);
  },

  /**
   * Validate unit conversion using PostgreSQL fn_compute_base_quantity
   * @param {string} itemId
   * @param {number} quantity
   * @param {string} uomId
   */
  async validateAndConvert(itemId, quantity, uomId) {
    const unit = await unitsRepository.findById(uomId.toUpperCase());
    if (!unit) {
      throw ApiError.notFound(`Unit of measure '${uomId}' not found`);
    }

    try {
      const baseQty = await unitsRepository.computeBaseQuantity(itemId, quantity, uomId.toUpperCase());
      return {
        itemId,
        sourceQuantity: quantity,
        sourceUom: uomId.toUpperCase(),
        baseQuantity: baseQty,
      };
    } catch (err) {
      throw ApiError.badRequest(err.message || `Incompatible conversion for unit ${uomId}`);
    }
  },
};
