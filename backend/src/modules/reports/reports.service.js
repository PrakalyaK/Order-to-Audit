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

  async getSalesRegister(filters) {
    return reportsRepository.getSalesRegister(filters);
  },

  async getPurchaseRegister(filters) {
    return reportsRepository.getPurchaseRegister(filters);
  },

  async getStockSummary() {
    return reportsRepository.getStockSummary();
  },

  async getStockLedger(filters) {
    return reportsRepository.getStockLedger(filters);
  },

  async getYieldAndWastage(filters) {
    return reportsRepository.getYieldAndWastage(filters);
  },

  async getCostPerPacket(filters) {
    return reportsRepository.getCostPerPacket(filters);
  },

  async getReceivablesAgeing() {
    return reportsRepository.getReceivablesAgeing();
  },
};
