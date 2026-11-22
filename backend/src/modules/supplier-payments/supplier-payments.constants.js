export const SUPPLIER_PAYMENT_MODES = {
  CASH: 'cash',
  UPI: 'upi',
  NEFT_RTGS: 'neft_rtgs',
  BANK_TRANSFER: 'bank_transfer',
  CHEQUE: 'cheque',
  LEGACY_RECONCILIATION: 'legacy_reconciliation',
};

export const SUPPLIER_PAYMENT_STATUS = {
  DRAFT: 'draft',
  POSTED: 'posted',
  CANCELLED: 'cancelled',
  REVERSED: 'reversed',
};

export const ALLOCATION_STATUS = {
  ACTIVE: 'active',
  REVERSED: 'reversed',
};

export const roundMoney = (val) => {
  if (val === null || val === undefined) return 0;
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
};
