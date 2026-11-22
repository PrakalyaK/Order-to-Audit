import { salesOrdersService } from './sales-orders.service.js';

export const create = async (req, res, next) => {
  try {
    const result = await salesOrdersService.createSalesOrder(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Sales order submitted successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const result = await salesOrdersService.getSalesOrders(req.query, req.user);
    res.status(200).json({
      success: true,
      data: result.salesOrders,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getById = async (req, res, next) => {
  try {
    const result = await salesOrdersService.getSalesOrderById(req.params.id, req.user);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const update = async (req, res, next) => {
  try {
    const result = await salesOrdersService.updateSalesOrder(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Sales order updated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const approve = async (req, res, next) => {
  try {
    const result = await salesOrdersService.approveSalesOrder(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Sales order approved successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const reject = async (req, res, next) => {
  try {
    const result = await salesOrdersService.rejectSalesOrder(req.params.id, req.body.rejectionReason, req.user);
    res.status(200).json({
      success: true,
      message: 'Sales order rejected successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const cancel = async (req, res, next) => {
  try {
    const result = await salesOrdersService.cancelSalesOrder(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Sales order cancelled successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
