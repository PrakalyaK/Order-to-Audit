export const WAREHOUSE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
};

export const TRANSFER_STATUS = {
  DRAFT: 'draft',
  REQUESTED: 'requested',
  APPROVED: 'approved',
  IN_TRANSIT: 'in_transit',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};

export const roundMoney = (val) => {
  if (val === null || val === undefined) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
};
