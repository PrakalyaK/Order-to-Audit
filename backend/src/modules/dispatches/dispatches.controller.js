import { dispatchesService } from './dispatches.service.js';

export const create = async (req, res, next) => {
  try {
    const result = await dispatchesService.createDispatch(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Dispatch note created successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const result = await dispatchesService.getDispatches(req.query);
    res.status(200).json({
      success: true,
      data: result.dispatches,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getById = async (req, res, next) => {
  try {
    const result = await dispatchesService.getDispatchById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postDispatch = async (req, res, next) => {
  try {
    const result = await dispatchesService.postDispatch(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Dispatch posted successfully. Stock deducted and ledger updated.',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const deliverDispatch = async (req, res, next) => {
  try {
    const result = await dispatchesService.deliverDispatch(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Dispatch confirmed as delivered',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getCogs = async (req, res, next) => {
  try {
    const result = await dispatchesService.getCogsAndMargin(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
