import { invoicesService } from './invoices.service.js';

export const create = async (req, res, next) => {
  try {
    const result = await invoicesService.createInvoice(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'GST Tax Invoice generated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const result = await invoicesService.getInvoices(req.query);
    res.status(200).json({
      success: true,
      data: result.invoices,
      pagination: result.pagination,
    });
  } catch (err) {
    next(err);
  }
};

export const getById = async (req, res, next) => {
  try {
    const result = await invoicesService.getInvoiceById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const cancel = async (req, res, next) => {
  try {
    const result = await invoicesService.cancelInvoice(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Invoice cancelled successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getGstOutwardReport = async (req, res, next) => {
  try {
    const result = await invoicesService.getGstOutwardSummary(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getCustomerOutstandingReport = async (req, res, next) => {
  try {
    const result = await invoicesService.getCustomerOutstanding(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getBalancesReport = async (req, res, next) => {
  try {
    const result = await invoicesService.getInvoiceBalances(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
