import { asyncHandler } from '../../utils/asyncHandler.js';
import { inventoryService } from './inventory.service.js';

export const getCurrentStock = asyncHandler(async (req, res) => {
  const stock = await inventoryService.getCurrentStock(req.query);
  res.status(200).json({
    success: true,
    data: { stock },
  });
});

export const getItemStock = asyncHandler(async (req, res) => {
  const stock = await inventoryService.getItemStock(req.params.itemId);
  res.status(200).json({
    success: true,
    data: { stock },
  });
});

export const getLowStock = asyncHandler(async (req, res) => {
  const lowStock = await inventoryService.getLowStock();
  res.status(200).json({
    success: true,
    data: { low_stock_items: lowStock },
  });
});

export const getValuation = asyncHandler(async (req, res) => {
  const valuation = await inventoryService.getValuation();
  res.status(200).json({
    success: true,
    data: valuation,
  });
});

export const getLedger = asyncHandler(async (req, res) => {
  const ledger = await inventoryService.getLedger(req.query);
  res.status(200).json({
    success: true,
    data: ledger,
  });
});

export const checkAvailability = asyncHandler(async (req, res) => {
  const result = await inventoryService.checkAvailability(req.body.items);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const createStockAdjustment = asyncHandler(async (req, res) => {
  const result = await inventoryService.createStockAdjustment(req.body, req.user);
  res.status(201).json({
    success: true,
    message: 'Stock adjustment record created successfully',
    data: result,
  });
});

export const postStockAdjustment = asyncHandler(async (req, res) => {
  const result = await inventoryService.postStockAdjustment(req.params.id, req.user);
  res.status(200).json({
    success: true,
    message: 'Stock adjustment posted to inventory ledger and financial accounts',
    data: result,
  });
});

export const getAdjustments = asyncHandler(async (req, res) => {
  const result = await inventoryService.getAdjustments(req.query);
  res.status(200).json({
    success: true,
    data: result.adjustments,
    pagination: result.pagination,
  });
});

export const getAdjustmentById = asyncHandler(async (req, res) => {
  const result = await inventoryService.getAdjustmentById(req.params.id);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getDiscrepancies = asyncHandler(async (req, res) => {
  const result = await inventoryService.getDiscrepancies();
  res.status(200).json({
    success: true,
    data: result,
  });
});
