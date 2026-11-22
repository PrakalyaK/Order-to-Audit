export const PAYROLL_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  PAID: 'paid',
  CANCELLED: 'cancelled',
};

export const roundMoney = (val) => {
  if (val === null || val === undefined) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
};
