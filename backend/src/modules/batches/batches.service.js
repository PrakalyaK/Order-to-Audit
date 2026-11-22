import { batchesRepository } from './batches.repository.js';

class BatchesService {
  async getBatches(filters = {}) {
    return batchesRepository.findBatches(filters);
  }

  async getNearExpiryBatches(warehouseId) {
    return batchesRepository.findNearExpiryBatches(warehouseId);
  }

  async getExpiredBatches(warehouseId) {
    return batchesRepository.findExpiredBatches(warehouseId);
  }

  async getFefoRecommendation(itemId, requestedQty, warehouseId) {
    const batches = await batchesRepository.findBatchesForFefo(itemId, warehouseId);

    let remainingNeeded = Number(requestedQty);
    const allocations = [];

    for (const b of batches) {
      if (remainingNeeded <= 0) break;

      const avail = Number(b.available_qty);
      const toTake = Math.min(avail, remainingNeeded);

      allocations.push({
        batch_number: b.batch_number,
        warehouse_id: b.warehouse_id,
        warehouse_code: b.warehouse_code,
        expiry_date: b.expiry_date,
        days_to_expiry: b.days_to_expiry,
        available_qty: avail,
        allocated_qty: toTake,
        unit_cost: Number(b.unit_cost),
      });

      remainingNeeded = Math.round((remainingNeeded - toTake) * 10000) / 10000;
    }

    const totalAllocated = Math.round((Number(requestedQty) - remainingNeeded) * 10000) / 10000;

    return {
      item_id: itemId,
      requested_quantity: Number(requestedQty),
      requested_qty: Number(requestedQty),
      total_allocated_quantity: totalAllocated,
      allocated_qty: totalAllocated,
      shortfall_quantity: remainingNeeded > 0 ? remainingNeeded : 0,
      shortfall_qty: remainingNeeded > 0 ? remainingNeeded : 0,
      can_fulfill: remainingNeeded <= 0,
      is_sufficient: remainingNeeded <= 0,
      batches: allocations,
      fefo_allocations: allocations,
    };
  }

  async getBatchTraceability(batchNumber) {
    return batchesRepository.getTraceabilityByBatch(batchNumber);
  }
}

export const batchesService = new BatchesService();
