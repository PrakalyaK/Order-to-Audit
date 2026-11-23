import { reportsRepository } from './reports.repository.js';

export const reportsService = {
  async getDashboardKpis() {
    return reportsRepository.getDashboardKpis();
  },

  async getSalesAnalytics() {
    return reportsRepository.getSalesAnalytics();
  },

  async getInventoryAnalytics() {
    return reportsRepository.getInventoryAnalytics();
  },

  async getProductionAnalytics() {
    return reportsRepository.getProductionAnalytics();
  },

  async getFinancialAnalytics() {
    return reportsRepository.getFinancialAnalytics();
  },

  async getBatchTraceability(batchNumber) {
    return reportsRepository.getBatchTraceability(batchNumber);
  },
};
