import { batchesService } from './batches.service.js';

export const getBatches = async (req, res, next) => {
  try {
    const result = await batchesService.getBatches(req.query);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const getNearExpiry = async (req, res, next) => {
  try {
    const result = await batchesService.getNearExpiryBatches(req.query.warehouse_id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const getExpired = async (req, res, next) => {
  try {
    const result = await batchesService.getExpiredBatches(req.query.warehouse_id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const getFefo = async (req, res, next) => {
  try {
    const result = await batchesService.getFefoRecommendation(
      req.params.itemId,
      req.query.quantity,
      req.query.warehouse_id
    );
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const getTraceability = async (req, res, next) => {
  try {
    const result = await batchesService.getBatchTraceability(req.params.batchNumber);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};
