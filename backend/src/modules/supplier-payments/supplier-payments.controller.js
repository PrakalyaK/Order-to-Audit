import { supplierPaymentsService } from './supplier-payments.service.js';

export const recordPayment = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.recordPayment(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Supplier payment recorded successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getPayments = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.getPayments(req.query);
    res.status(200).json({
      success: true,
      data: result.payments,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getPaymentById = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.getPaymentById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const allocatePayment = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.allocatePayment(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Supplier payment allocated to bill successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const reversePayment = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.reversePayment(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Supplier payment reversed successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getPayablesSummary = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.getPayablesSummary();
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getSupplierOutstanding = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.getSupplierOutstanding(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getPurchaseBillBalances = async (req, res, next) => {
  try {
    const result = await supplierPaymentsService.getPurchaseBillBalances(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
