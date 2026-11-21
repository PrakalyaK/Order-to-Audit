import { productionRepository } from './production.repository.js';
import { bomsRepository } from '../boms/boms.repository.js';
import { bomsService } from '../boms/boms.service.js';
import { itemsRepository } from '../items/items.repository.js';
import { unitsRepository } from '../units/units.repository.js';
import { inventoryRepository } from '../inventory/inventory.repository.js';
import { inventoryService } from '../inventory/inventory.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { PRODUCTION_STATUS } from './production.constants.js';
import { getClient } from '../../config/db.js';

export const productionService = {
  /**
   * List production runs with filters and pagination
   */
  async getProductionRuns(queryParams) {
    return await productionRepository.findAll(queryParams);
  },

  /**
   * Get production run details by ID
   */
  async getProductionRunById(id) {
    const run = await productionRepository.findById(id);
    if (!run) {
      throw ApiError.notFound(`Production run with ID '${id}' not found`);
    }
    return run;
  },

  /**
   * Create a new draft production run based on an active BOM
   */
  async createProductionRun(data, userId) {
    const { bom_id, run_date, planned_batch_count = 1.0, output_batch_number, notes, inputs: explicitInputs } = data;

    // 1. Verify BOM exists and is active
    const bom = await bomsRepository.findById(bom_id);
    if (!bom) {
      throw ApiError.notFound(`BOM with ID '${bom_id}' not found`);
    }
    if (!bom.is_active) {
      throw ApiError.badRequest(`BOM '${bom.bom_code}' (version ${bom.version_number}) is not active. Production runs require an active BOM.`);
    }

    if (!bom.materials || bom.materials.length === 0) {
      throw ApiError.badRequest(`BOM '${bom.bom_code}' has no configured material items`);
    }

    // 2. Compute planned yield and batch calculations
    const standardBatchSize = parseFloat(bom.standard_batch_size);
    const batchCount = parseFloat(planned_batch_count);
    const plannedYieldQty = Math.round(standardBatchSize * batchCount * 10000) / 10000;

    // 3. Compute material requirements using BOM calculation engine
    const requirements = await bomsService.calculateRequirements(bom_id, plannedYieldQty, bom.batch_uom_id);

    // 4. Generate sequential run number and output batch number if not provided
    const runNumber = await productionRepository.generateRunNumber(run_date);
    const finalBatchNumber = output_batch_number || `BAT-${bom.finished_good_sku.replace(/[^A-Za-z0-9]/g, '')}-${run_date.replace(/-/g, '')}-01`;

    // 5. Prepare input lines
    let inputLines = [];

    if (explicitInputs && explicitInputs.length > 0) {
      // Validate provided inputs
      for (const input of explicitInputs) {
        const baseConsumed = await unitsRepository.computeBaseQuantity(
          input.item_id,
          input.actual_issued_qty - (input.returned_to_store_qty || 0),
          input.uom_id
        );

        const goodQty = input.good_production_qty !== undefined ? input.good_production_qty : input.actual_issued_qty;
        const scrapQty = input.damaged_or_scrap_qty !== undefined ? input.damaged_or_scrap_qty : 0.0000;
        const retQty = input.returned_to_store_qty !== undefined ? input.returned_to_store_qty : 0.0000;

        // Mass balance check
        if (Math.abs(input.actual_issued_qty - (goodQty + scrapQty + retQty)) > 0.0001) {
          throw ApiError.badRequest(
            `Mass balance violation: Issued (${input.actual_issued_qty}) must equal Good (${goodQty}) + Scrap (${scrapQty}) + Returned (${retQty})`
          );
        }

        inputLines.push({
          item_id: input.item_id,
          planned_qty: input.planned_qty,
          actual_issued_qty: input.actual_issued_qty,
          good_production_qty: goodQty,
          damaged_or_scrap_qty: scrapQty,
          returned_to_store_qty: retQty,
          uom_id: input.uom_id,
          base_net_consumed_qty: baseConsumed,
          unit_cost_applied: 0.0000,
          total_material_cost: 0.00,
          consumption_variance_qty: 0.0000,
          consumption_variance_pct: 0.00,
          is_consumption_flagged: false,
        });
      }
    } else {
      // Auto-populate from BOM material requirements
      for (const mat of requirements.materials) {
        const baseConsumed = await unitsRepository.computeBaseQuantity(
          mat.item_id,
          mat.total_required_qty,
          mat.uom_id
        );

        inputLines.push({
          item_id: mat.item_id,
          planned_qty: mat.total_required_qty,
          actual_issued_qty: mat.total_required_qty,
          good_production_qty: mat.total_required_qty,
          damaged_or_scrap_qty: 0.0000,
          returned_to_store_qty: 0.0000,
          uom_id: mat.uom_id,
          base_net_consumed_qty: baseConsumed,
          unit_cost_applied: 0.0000,
          total_material_cost: 0.00,
          consumption_variance_qty: 0.0000,
          consumption_variance_pct: 0.00,
          is_consumption_flagged: false,
        });
      }
    }

    // 6. Check material availability pre-flight check
    const availabilityItems = inputLines.map((inp) => ({
      item_id: inp.item_id,
      required_qty: inp.actual_issued_qty,
      uom_id: inp.uom_id,
    }));
    const availability = await inventoryService.checkAvailability(availabilityItems);

    // 7. Save draft production run and inputs
    const createdRunHeader = await productionRepository.createWithInputs(
      {
        run_number: runNumber,
        bom_id,
        finished_good_item_id: bom.finished_good_item_id,
        output_batch_number: finalBatchNumber,
        run_date,
        planned_batch_count: batchCount,
        standard_batch_size: standardBatchSize,
        planned_yield_qty: plannedYieldQty,
        supervisor_id: userId,
        notes,
      },
      inputLines
    );

    const fullRun = await productionRepository.findById(createdRunHeader.id);
    fullRun.stock_availability = availability;

    return fullRun;
  },

  /**
   * Issue materials for production run (Atomic PostgreSQL Posting)
   */
  async issueMaterials(id, userId, overrideData = null) {
    const run = await productionRepository.findById(id);
    if (!run) {
      throw ApiError.notFound(`Production run with ID '${id}' not found`);
    }

    if (run.status !== PRODUCTION_STATUS.DRAFT) {
      throw ApiError.badRequest(
        `Production run '${run.run_number}' is in status '${run.status}'. Materials can only be issued for runs in 'draft' status.`
      );
    }

    // 1. If override inputs provided, validate and update before posting
    if (overrideData && overrideData.inputs && overrideData.inputs.length > 0) {
      const updatedInputs = [];
      for (const inp of overrideData.inputs) {
        const existingInput = run.inputs.find((i) => i.item_id === inp.item_id);
        if (!existingInput) {
          throw ApiError.badRequest(`Item '${inp.item_id}' is not an input item for this production run`);
        }

        const actualIssued = inp.actual_issued_qty !== undefined ? inp.actual_issued_qty : parseFloat(existingInput.actual_issued_qty);
        const goodQty = inp.good_production_qty !== undefined ? inp.good_production_qty : actualIssued;
        const scrapQty = inp.damaged_or_scrap_qty !== undefined ? inp.damaged_or_scrap_qty : 0.0000;
        const retQty = inp.returned_to_store_qty !== undefined ? inp.returned_to_store_qty : 0.0000;
        const uomId = inp.uom_id || existingInput.uom_id;

        // Mass balance validation
        if (Math.abs(actualIssued - (goodQty + scrapQty + retQty)) > 0.0001) {
          throw ApiError.badRequest(
            `Mass balance error for item '${existingInput.item_name}': Issued (${actualIssued}) != Good (${goodQty}) + Scrap (${scrapQty}) + Returned (${retQty})`
          );
        }

        const baseConsumed = await unitsRepository.computeBaseQuantity(
          inp.item_id,
          actualIssued - retQty,
          uomId
        );

        updatedInputs.push({
          item_id: inp.item_id,
          actual_issued_qty: actualIssued,
          good_production_qty: goodQty,
          damaged_or_scrap_qty: scrapQty,
          returned_to_store_qty: retQty,
          base_net_consumed_qty: baseConsumed,
        });
      }

      await productionRepository.updateInputs(id, updatedInputs);
    }

    // Refresh run inputs after updates
    const refreshedRun = await productionRepository.findById(id);

    // 2. Pre-check stock sufficiency for all inputs to provide clean API error
    for (const input of refreshedRun.inputs) {
      const stock = await inventoryRepository.findStockByItemId(input.item_id);
      const availableQty = stock ? parseFloat(stock.closing_stock_base_qty) : 0.0000;
      const requiredQty = parseFloat(input.base_net_consumed_qty);

      if (availableQty < requiredQty) {
        throw ApiError.badRequest(
          `Insufficient stock for '${input.item_name}'. Required: ${requiredQty.toFixed(4)}, Available: ${availableQty.toFixed(4)}`
        );
      }
    }

    // 3. Execute atomic PostgreSQL issue function
    await productionRepository.executePostIssue(id, userId);

    return await productionRepository.findById(id);
  },

  /**
   * Record actual output yield, overheads, and post production yield & costing
   */
  async recordYieldAndCosting(id, userId, yieldData) {
    const run = await productionRepository.findById(id);
    if (!run) {
      throw ApiError.notFound(`Production run with ID '${id}' not found`);
    }

    if (run.status !== PRODUCTION_STATUS.MATERIALS_ISSUED) {
      throw ApiError.badRequest(
        `Production run '${run.run_number}' is in status '${run.status}'. Yield can only be posted for runs in 'materials_issued' status.`
      );
    }

    const goodOutput = parseFloat(yieldData.actual_good_output_qty);
    const scrapOutput = parseFloat(yieldData.actual_scrap_output_qty || 0);

    if (goodOutput <= 0) {
      throw ApiError.badRequest('Actual good output quantity must be greater than zero');
    }

    const plannedYield = parseFloat(run.planned_yield_qty);
    const yieldVarianceQty = goodOutput - plannedYield;
    const yieldVariancePct = plannedYield > 0
      ? Math.round(((goodOutput - plannedYield) / plannedYield) * 10000) / 100
      : 0.00;

    const tolerance = parseFloat(run.tolerance_variance_pct || 5.0);
    const isYieldFlagged = Math.abs(yieldVariancePct) > tolerance;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 1. Update header actual output and variance
      await productionRepository.updateOutputAndVariance(
        id,
        {
          actual_good_output_qty: goodOutput,
          actual_scrap_output_qty: scrapOutput,
          yield_variance_pct: yieldVariancePct,
          is_yield_flagged: isYieldFlagged,
        },
        client
      );

      // 2. Save overheads if provided
      if (yieldData.overheads && yieldData.overheads.length > 0) {
        await productionRepository.saveOverheads(id, yieldData.overheads, client);
      }

      // 3. Execute atomic PostgreSQL yield posting function
      await productionRepository.executePostYield(id, userId, client);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return await productionRepository.findById(id);
  },

  /**
   * Cancel draft production run
   */
  async cancelProductionRun(id, userId, notes = null) {
    const run = await productionRepository.findById(id);
    if (!run) {
      throw ApiError.notFound(`Production run with ID '${id}' not found`);
    }

    if (run.status !== PRODUCTION_STATUS.DRAFT) {
      throw ApiError.badRequest(
        `Cannot cancel production run '${run.run_number}' in status '${run.status}'. Only draft production runs can be cancelled.`
      );
    }

    return await productionRepository.cancelRun(id, notes);
  },

  /**
   * Get production run mass balance and consumption variance
   */
  async getProductionRunVariance(id) {
    const run = await productionRepository.findById(id);
    if (!run) {
      throw ApiError.notFound(`Production run with ID '${id}' not found`);
    }

    const variance = await productionRepository.getVariance(id);
    return {
      production_run_id: run.id,
      run_number: run.run_number,
      run_date: run.run_date,
      status: run.status,
      bom_code: run.bom_code,
      finished_good: {
        sku: run.finished_good_sku,
        name: run.finished_good_name,
      },
      planned_yield_qty: parseFloat(run.planned_yield_qty),
      actual_good_output_qty: parseFloat(run.actual_good_output_qty),
      actual_scrap_output_qty: parseFloat(run.actual_scrap_output_qty),
      yield_variance_qty: parseFloat(run.yield_variance_qty),
      yield_variance_pct: parseFloat(run.yield_variance_pct),
      is_yield_flagged: run.is_yield_flagged,
      materials: variance,
    };
  },

  /**
   * Get production run costing breakdown
   */
  async getProductionRunCosting(id) {
    const run = await productionRepository.findById(id);
    if (!run) {
      throw ApiError.notFound(`Production run with ID '${id}' not found`);
    }

    const costing = await productionRepository.getCosting(id);
    if (!costing) {
      throw ApiError.notFound(`Costing is not available for production run '${run.run_number}'. Costing is generated upon yield completion.`);
    }

    return {
      production_run_id: run.id,
      run_number: run.run_number,
      status: run.status,
      finished_good: {
        sku: run.finished_good_sku,
        name: run.finished_good_name,
      },
      costing,
      overheads: run.overheads,
    };
  },
};
