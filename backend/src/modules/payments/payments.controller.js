import { paymentsService } from './payments.service.js';

export const create = async (req, res, next) => {
  try {
    const result = await paymentsService.createPayment(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const result = await paymentsService.getPayments(req.query);
    res.status(200).json({
      success: true,
      data: result.payments,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getById = async (req, res, next) => {
  try {
    const result = await paymentsService.getPaymentById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateDraft = async (req, res, next) => {
  try {
    const result = await paymentsService.updateDraftPayment(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Draft payment updated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const postPayment = async (req, res, next) => {
  try {
    const result = await paymentsService.postPayment(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Payment posted successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const cancelDraft = async (req, res, next) => {
  try {
    const result = await paymentsService.cancelDraftPayment(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Draft payment cancelled successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const allocate = async (req, res, next) => {
  try {
    const result = await paymentsService.allocatePayment(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Payment allocated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const reverse = async (req, res, next) => {
  try {
    const result = await paymentsService.reversePayment(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Payment reversed successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const reverseAllocation = async (req, res, next) => {
  try {
    const result = await paymentsService.reverseAllocation(req.params.allocationId, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Payment allocation reversed successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getCustomerHistory = async (req, res, next) => {
  try {
    const result = await paymentsService.getCustomerPaymentHistory(req.params.customerId);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getInvoiceHistory = async (req, res, next) => {
  try {
    const result = await paymentsService.getInvoicePaymentHistory(req.params.invoiceId);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getReceivablesSummary = async (req, res, next) => {
  try {
    const result = await paymentsService.getReceivablesSummary();
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getCustomerReceivables = async (req, res, next) => {
  try {
    const result = await paymentsService.getCustomerReceivables(req.query);
    res.status(200).json({
      success: true,
      data: result.receivables,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getInvoiceBalances = async (req, res, next) => {
  try {
    const result = await paymentsService.getInvoiceBalances(req.query);
    res.status(200).json({
      success: true,
      data: result.invoices,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};
