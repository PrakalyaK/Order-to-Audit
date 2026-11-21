import { asyncHandler } from '../../utils/asyncHandler.js';
import { productionService } from './production.service.js';

export const getAll = asyncHandler(async (req, res) => {
  const result = await productionService.getProductionRuns(req.query);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const run = await productionService.getProductionRunById(req.params.id);
  res.status(200).json({
    success: true,
    data: run,
  });
});

export const create = asyncHandler(async (req, res) => {
  const run = await productionService.createProductionRun(req.body, req.user.id);
  res.status(201).json({
    success: true,
    message: 'Production run created successfully (draft)',
    data: run,
  });
});

export const issueMaterials = asyncHandler(async (req, res) => {
  const run = await productionService.issueMaterials(req.params.id, req.user.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Materials issued successfully',
    data: run,
  });
});

export const recordYield = asyncHandler(async (req, res) => {
  const run = await productionService.recordYieldAndCosting(req.params.id, req.user.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Production yield and costing posted successfully',
    data: run,
  });
});

export const cancel = asyncHandler(async (req, res) => {
  const run = await productionService.cancelProductionRun(req.params.id, req.user.id, req.body.notes);
  res.status(200).json({
    success: true,
    message: 'Production run cancelled successfully',
    data: run,
  });
});

export const getVariance = asyncHandler(async (req, res) => {
  const variance = await productionService.getProductionRunVariance(req.params.id);
  res.status(200).json({
    success: true,
    data: variance,
  });
});

export const getCosting = asyncHandler(async (req, res) => {
  const costing = await productionService.getProductionRunCosting(req.params.id);
  res.status(200).json({
    success: true,
    data: costing,
  });
});
