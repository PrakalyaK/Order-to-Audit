/**
 * Production Constants
 */
export const PRODUCTION_STATUS = {
  DRAFT: 'draft',
  MATERIALS_ISSUED: 'materials_issued',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const OVERHEAD_TYPES = {
  LABOUR: 'labour',
  POWER_GAS: 'power_gas',
  MAINTENANCE: 'maintenance',
  DEPRECIATION: 'depreciation',
  OTHER: 'other',
};

export const VALID_OVERHEAD_TYPES = [
  OVERHEAD_TYPES.LABOUR,
  OVERHEAD_TYPES.POWER_GAS,
  OVERHEAD_TYPES.MAINTENANCE,
  OVERHEAD_TYPES.DEPRECIATION,
  OVERHEAD_TYPES.OTHER,
];
