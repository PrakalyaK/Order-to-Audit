import { bomsRepository } from './boms.repository.js';
import { itemsRepository } from '../items/items.repository.js';
import { unitsRepository } from '../units/units.repository.js';
import { ApiError } from '../../utils/ApiError.js';
import { ITEM_TYPES } from '../items/items.constants.js';

export const bomsService = {
  /**
   * Get paginated BOM list
   */
  async getBoms(queryParams) {
    return await bomsRepository.findAll(queryParams);
  },

  /**
   * Get BOM details by ID
   */
  async getBomById(id) {
    const bom = await bomsRepository.findById(id);
    if (!bom) {
      throw ApiError.notFound(`BOM with ID '${id}' not found`);
    }
    return bom;
  },

  /**
   * Create a new BOM version with materials
   */
  async createBom(data, userId) {
    const { materials, ...bomHeader } = data;

    // Rule 1: BOM must reference a valid finished-good item
    const finishedGood = await itemsRepository.findById(bomHeader.finished_good_item_id);
    if (!finishedGood) {
      throw ApiError.notFound(`Finished good item with ID '${bomHeader.finished_good_item_id}' not found`);
    }
    if (finishedGood.item_type !== ITEM_TYPES.FINISHED_GOOD) {
      throw ApiError.badRequest(
        `Item '${finishedGood.sku}' has item_type '${finishedGood.item_type}'. A BOM can only be created for items of type 'finished_good'.`
      );
    }

    // Rule 8: Batch UOM must exist and be compatible with finished good base UOM
    const batchUom = await unitsRepository.findById(bomHeader.batch_uom_id);
    if (!batchUom) {
      throw ApiError.badRequest(`Batch unit '${bomHeader.batch_uom_id}' does not exist`);
    }
    const fgUom = await unitsRepository.findById(finishedGood.base_uom_id);
    if (batchUom.dimension !== fgUom.dimension && !(batchUom.dimension === 'packaging' && fgUom.dimension === 'count')) {
      throw ApiError.badRequest(
        `Batch UOM '${bomHeader.batch_uom_id}' dimension (${batchUom.dimension}) is incompatible with finished good base UOM '${finishedGood.base_uom_id}' (${fgUom.dimension})`
      );
    }

    // Check version uniqueness for this finished good
    const existingVersion = await bomsRepository.findByProductAndVersion(
      bomHeader.finished_good_item_id,
      bomHeader.version_number
    );
    if (existingVersion) {
      throw ApiError.conflict(
        `BOM version ${bomHeader.version_number} already exists for product '${finishedGood.sku}'`
      );
    }

    // Validate materials
    const seenItemIds = new Set();
    for (const mat of materials) {
      // Rule 3: Finished product cannot be its own raw material
      if (mat.item_id === bomHeader.finished_good_item_id) {
        throw ApiError.badRequest(`Finished good item '${finishedGood.sku}' cannot be included as its own raw material in the BOM`);
      }

      // Rule 6: Prevent duplicate material entries in the same BOM
      if (seenItemIds.has(mat.item_id)) {
        throw ApiError.badRequest(`Duplicate material entry: item '${mat.item_id}' is specified more than once in this BOM`);
      }
      seenItemIds.add(mat.item_id);

      // Rule 2: BOM materials must reference valid raw material, packaging, or WIP items
      const matItem = await itemsRepository.findById(mat.item_id);
      if (!matItem) {
        throw ApiError.notFound(`Material item with ID '${mat.item_id}' not found`);
      }
      if (matItem.item_type === ITEM_TYPES.FINISHED_GOOD) {
        throw ApiError.badRequest(
          `Material '${matItem.sku}' is a 'finished_good'. Only raw_material, packaging, or work_in_progress items can be BOM materials.`
        );
      }

      // Rule 4: Quantities must be positive
      if (mat.standard_qty <= 0) {
        throw ApiError.badRequest(`Quantity for material '${matItem.sku}' must be greater than 0`);
      }

      // Rule 5: Material UOM must exist and be compatible with material's base unit
      const matUom = await unitsRepository.findById(mat.uom_id);
      if (!matUom) {
        throw ApiError.badRequest(`UOM '${mat.uom_id}' for material '${matItem.sku}' does not exist`);
      }
      const matBaseUom = await unitsRepository.findById(matItem.base_uom_id);
      if (matUom.dimension !== matBaseUom.dimension && !(matUom.dimension === 'packaging' && matBaseUom.dimension === 'count')) {
        throw ApiError.badRequest(
          `UOM '${mat.uom_id}' (${matUom.dimension}) for material '${matItem.sku}' is incompatible with item base UOM '${matItem.base_uom_id}' (${matBaseUom.dimension})`
        );
      }
    }

    bomHeader.created_by = userId;
    return await bomsRepository.createWithMaterials(bomHeader, materials);
  },

  /**
   * Update an existing BOM version
   */
  async updateBom(id, updateData, userId) {
    const existing = await bomsRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`BOM with ID '${id}' not found`);
    }

    // Rule 10: Do not allow modification of a BOM version that has already been used in production
    const isUsed = await bomsRepository.isUsedInProduction(id);
    if (isUsed && (updateData.materials !== undefined || updateData.standard_batch_size !== undefined || updateData.batch_uom_id !== undefined)) {
      throw ApiError.badRequest(
        `Cannot modify batch size or materials for BOM '${existing.bom_code}' (v${existing.version_number}) because it has already been used in recorded production runs. To alter the recipe, please create a new BOM version.`
      );
    }

    const { materials, ...headerData } = updateData;

    // Validate standard_batch_size if updated
    if (headerData.standard_batch_size !== undefined && headerData.standard_batch_size <= 0) {
      throw ApiError.badRequest('standard_batch_size must be greater than 0');
    }

    // Validate batch_uom_id if updated
    if (headerData.batch_uom_id !== undefined) {
      const batchUom = await unitsRepository.findById(headerData.batch_uom_id);
      if (!batchUom) {
        throw ApiError.badRequest(`Batch unit '${headerData.batch_uom_id}' does not exist`);
      }
      const fg = await itemsRepository.findById(existing.finished_good_item_id);
      const fgUom = await unitsRepository.findById(fg.base_uom_id);
      if (batchUom.dimension !== fgUom.dimension && !(batchUom.dimension === 'packaging' && fgUom.dimension === 'count')) {
        throw ApiError.badRequest(
          `Batch UOM '${headerData.batch_uom_id}' dimension (${batchUom.dimension}) is incompatible with finished good base UOM '${fg.base_uom_id}' (${fgUom.dimension})`
        );
      }
    }

    // If materials are being updated on an unused BOM, perform identical comprehensive validations
    if (materials !== undefined) {
      if (materials.length === 0) {
        throw ApiError.badRequest('A BOM must have at least one material entry');
      }

      const seenItemIds = new Set();
      for (const mat of materials) {
        // Rule 3: Finished product cannot be its own raw material
        if (mat.item_id === existing.finished_good_item_id) {
          throw ApiError.badRequest(`Finished good item cannot be included as its own raw material in the BOM`);
        }

        // Rule 6: Duplicate material prevention
        if (seenItemIds.has(mat.item_id)) {
          throw ApiError.badRequest(`Duplicate material entry: item '${mat.item_id}' is specified more than once in this BOM`);
        }
        seenItemIds.add(mat.item_id);

        // Rule 2: Material existence & non-finished good validation
        const matItem = await itemsRepository.findById(mat.item_id);
        if (!matItem) {
          throw ApiError.notFound(`Material item with ID '${mat.item_id}' not found`);
        }
        if (matItem.item_type === ITEM_TYPES.FINISHED_GOOD) {
          throw ApiError.badRequest(
            `Material '${matItem.sku}' is a 'finished_good'. Only raw_material, packaging, or work_in_progress items can be BOM materials.`
          );
        }

        // Rule 4: Material quantity must be positive
        if (mat.standard_qty <= 0) {
          throw ApiError.badRequest(`Quantity for material '${matItem.sku}' must be greater than 0`);
        }

        // Rule 5: Material UOM existence & dimensional compatibility
        const matUom = await unitsRepository.findById(mat.uom_id);
        if (!matUom) {
          throw ApiError.badRequest(`UOM '${mat.uom_id}' for material '${matItem.sku}' does not exist`);
        }
        const matBaseUom = await unitsRepository.findById(matItem.base_uom_id);
        if (matUom.dimension !== matBaseUom.dimension && !(matUom.dimension === 'packaging' && matBaseUom.dimension === 'count')) {
          throw ApiError.badRequest(
            `UOM '${mat.uom_id}' (${matUom.dimension}) for material '${matItem.sku}' is incompatible with item base UOM '${matItem.base_uom_id}' (${matBaseUom.dimension})`
          );
        }
      }
    }

    await bomsRepository.updateWithMaterials(id, headerData, materials);
    return await bomsRepository.findById(id);
  },

  /**
   * Toggle BOM active status
   */
  async setBomStatus(id, isActive) {
    const existing = await bomsRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`BOM with ID '${id}' not found`);
    }

    return await bomsRepository.setStatus(id, isActive);
  },

  /**
   * Calculate required materials for a requested production quantity
   */
  async calculateRequirements(bomId, requestedOutputQty, outputUomId) {
    const bom = await bomsRepository.findById(bomId);
    if (!bom) {
      throw ApiError.notFound(`BOM with ID '${bomId}' not found`);
    }

    if (!bom.materials || bom.materials.length === 0) {
      throw ApiError.badRequest(`BOM '${bom.bom_code}' has no configured material items`);
    }

    const standardBatchSize = parseFloat(bom.standard_batch_size);
    if (standardBatchSize <= 0) {
      throw ApiError.badRequest(`Invalid BOM batch size: ${standardBatchSize}`);
    }

    const targetOutputUomId = outputUomId ? outputUomId.trim().toUpperCase() : bom.batch_uom_id;
    let normalizedOutputQty = requestedOutputQty;

    // Output UOM conversion: If requested output UOM differs from BOM batch UOM, convert accurately
    if (targetOutputUomId !== bom.batch_uom_id) {
      const targetUom = await unitsRepository.findById(targetOutputUomId);
      if (!targetUom) {
        throw ApiError.badRequest(`Unit of measure '${targetOutputUomId}' does not exist`);
      }

      try {
        // Convert requested output quantity to finished good's base UOM
        const baseQty = await unitsRepository.computeBaseQuantity(
          bom.finished_good_item_id,
          requestedOutputQty,
          targetOutputUomId
        );

        // Convert 1 unit of BOM's batch UOM to finished good's base UOM
        const batchUomInBase = await unitsRepository.computeBaseQuantity(
          bom.finished_good_item_id,
          1,
          bom.batch_uom_id
        );

        if (batchUomInBase <= 0) {
          throw new Error('Batch UOM conversion factor must be positive');
        }

        normalizedOutputQty = Math.round((baseQty / batchUomInBase) * 10000) / 10000;
      } catch (err) {
        throw ApiError.badRequest(
          `Incompatible output UOM '${targetOutputUomId}' for finished good '${bom.finished_good_sku}' with batch UOM '${bom.batch_uom_id}': ${err.message}`
        );
      }
    }

    // Scale factor: (Normalized output / BOM standard batch size)
    const scaleFactor = Math.round((normalizedOutputQty / standardBatchSize) * 10000) / 10000;

    const calculatedMaterials = bom.materials.map((mat) => {
      const baseQtyPerBatch = parseFloat(mat.standard_qty);
      const scrapPct = parseFloat(mat.scrap_allowance_pct || 0);

      const plannedRequiredQty = Math.round(baseQtyPerBatch * scaleFactor * 10000) / 10000;
      const scrapAllowanceQty = Math.round(plannedRequiredQty * (scrapPct / 100) * 10000) / 10000;
      const totalRequiredWithScrap = Math.round((plannedRequiredQty + scrapAllowanceQty) * 10000) / 10000;

      return {
        item_id: mat.item_id,
        item_sku: mat.item_sku,
        item_name: mat.item_name,
        item_type: mat.item_type,
        standard_qty_per_batch: baseQtyPerBatch,
        uom_id: mat.uom_id,
        uom_name: mat.uom_name,
        planned_required_qty: plannedRequiredQty,
        scrap_allowance_pct: scrapPct,
        scrap_allowance_qty: scrapAllowanceQty,
        total_required_qty: totalRequiredWithScrap,
      };
    });

    return {
      bom_id: bom.id,
      bom_code: bom.bom_code,
      version_number: bom.version_number,
      finished_good: {
        id: bom.finished_good_item_id,
        sku: bom.finished_good_sku,
        name: bom.finished_good_name,
      },
      requested_output: {
        quantity: requestedOutputQty,
        uom_id: targetOutputUomId,
      },
      normalized_output: {
        quantity: normalizedOutputQty,
        uom_id: bom.batch_uom_id,
      },
      standard_batch_size: standardBatchSize,
      batch_uom_id: bom.batch_uom_id,
      scale_factor: scaleFactor,
      requested_output_qty: requestedOutputQty,
      requested_output_uom_id: targetOutputUomId,
      materials: calculatedMaterials,
      note: 'Purely mathematical planning requirement calculation. No inventory was deducted or altered.',
    };
  },
};
