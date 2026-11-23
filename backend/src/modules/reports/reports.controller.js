import { reportsService } from './reports.service.js';

export const getDashboard = async (req, res, next) => {
  try {
    const data = await reportsService.getDashboardKpis();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const getSales = async (req, res, next) => {
  try {
    const data = await reportsService.getSalesAnalytics();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const getInventory = async (req, res, next) => {
  try {
    const data = await reportsService.getInventoryAnalytics();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const getProduction = async (req, res, next) => {
  try {
    const data = await reportsService.getProductionAnalytics();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const getFinancial = async (req, res, next) => {
  try {
    const data = await reportsService.getFinancialAnalytics();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const getTraceability = async (req, res, next) => {
  try {
    const { batchNumber } = req.params;
    const data = await reportsService.getBatchTraceability(batchNumber);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};
