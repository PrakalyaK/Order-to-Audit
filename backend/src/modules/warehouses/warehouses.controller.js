import { warehousesService } from './warehouses.service.js';

export const getWarehouses = async (req, res, next) => {
  try {
    const result = await warehousesService.getWarehouses(req.query);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const getWarehouseById = async (req, res, next) => {
  try {
    const result = await warehousesService.getWarehouseById(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const createWarehouse = async (req, res, next) => {
  try {
    const result = await warehousesService.createWarehouse(req.body);
    res.status(201).json({
      success: true,
      message: 'Warehouse created successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateWarehouse = async (req, res, next) => {
  try {
    const result = await warehousesService.updateWarehouse(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Warehouse updated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getWarehouseStock = async (req, res, next) => {
  try {
    const result = await warehousesService.getWarehouseStock(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const getWarehouseValuation = async (req, res, next) => {
  try {
    const result = await warehousesService.getWarehouseValuation(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

export const createTransfer = async (req, res, next) => {
  try {
    const result = await warehousesService.createTransfer(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Stock transfer request created successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const approveTransfer = async (req, res, next) => {
  try {
    const result = await warehousesService.approveTransfer(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Stock transfer approved successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const dispatchTransfer = async (req, res, next) => {
  try {
    const result = await warehousesService.dispatchTransfer(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Stock transfer dispatched from source warehouse',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const receiveTransfer = async (req, res, next) => {
  try {
    const result = await warehousesService.receiveTransfer(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Stock transfer received at destination warehouse',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const cancelTransfer = async (req, res, next) => {
  try {
    const result = await warehousesService.cancelTransfer(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Stock transfer cancelled successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getTransfers = async (req, res, next) => {
  try {
    const result = await warehousesService.getTransfers(req.query);
    res.status(200).json({
      success: true,
      data: result.transfers,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getTransferById = async (req, res, next) => {
  try {
    const result = await warehousesService.getTransferById(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};
