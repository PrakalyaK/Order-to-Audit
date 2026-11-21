import { productionService } from './production.service.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

export const getAll = async (req, res, next) => {
  try {
    const result = await productionService.getProductionRuns(req.query);
    res.json(ApiResponse.success(result, 'Production runs retrieved successfully'));
  } catch (err) {
    next(err);
  }
};

export const getById = async (req, res, next) => {
  try {
    const run = await productionService.getProductionRunById(req.params.id);
    res.json(ApiResponse.success(run, 'Production run retrieved successfully'));
  } catch (err) {
    next(err);
  }
};

export const create = async (req, res, next) => {
  try {
    const run = await productionService.createProductionRun(req.body, req.user.id);
    res.status(201).json(ApiResponse.created(run, 'Production run created successfully'));
  } catch (err) {
    next(err);
  }
};

export const issueMaterials = async (req, res, next) => {
  try {
    const run = await productionService.issueMaterials(req.params.id, req.user.id, req.body);
    res.json(ApiResponse.success(run, 'Materials issued successfully'));
  } catch (err) {
    next(err);
  }
};

export const recordYield = async (req, res, next) => {
  try {
    const run = await productionService.recordYieldAndCosting(req.params.id, req.user.id, req.body);
    res.json(ApiResponse.success(run, 'Production yield and costing posted successfully'));
  } catch (err) {
    next(err);
  }
};

export const cancel = async (req, res, next) => {
  try {
    const run = await productionService.cancelProductionRun(req.params.id, req.user.id, req.body.notes);
    res.json(ApiResponse.success(run, 'Production run cancelled successfully'));
  } catch (err) {
    next(err);
  }
};

export const getVariance = async (req, res, next) => {
  try {
    const variance = await productionService.getProductionRunVariance(req.params.id);
    res.json(ApiResponse.success(variance, 'Production variance retrieved successfully'));
  } catch (err) {
    next(err);
  }
};

export const getCosting = async (req, res, next) => {
  try {
    const costing = await productionService.getProductionRunCosting(req.params.id);
    res.json(ApiResponse.success(costing, 'Production costing retrieved successfully'));
  } catch (err) {
    next(err);
  }
};
