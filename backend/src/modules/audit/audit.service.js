import { auditRepository } from './audit.repository.js';

export const auditService = {
  async getLogs(params) {
    return auditRepository.findLogs(params);
  },

  async getFilters() {
    const [entities, actions] = await Promise.all([
      auditRepository.getEntities(),
      auditRepository.getActions(),
    ]);
    return { entities, actions };
  },
};
