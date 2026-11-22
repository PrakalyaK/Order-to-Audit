/**
 * Invoices Constants
 */
export const INVOICE_STATUS = {
  DRAFT: 'draft',
  POSTED: 'posted',
  DISPATCHED: 'dispatched',
  CANCELLED: 'cancelled',
};

export const VALID_INVOICE_STATUSES = [
  INVOICE_STATUS.DRAFT,
  INVOICE_STATUS.POSTED,
  INVOICE_STATUS.DISPATCHED,
  INVOICE_STATUS.CANCELLED,
];

/**
 * Compute Indian Financial Year string (e.g., '2026-27' for 2026-11-15)
 * Financial year starts April 1 and ends March 31.
 */
export function getFinancialYear(date = new Date()) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed: 0 = Jan, 3 = Apr

  if (month < 3) {
    // Jan - Mar
    const startYear = year - 1;
    const endYearShort = String(year).slice(-2);
    return `${startYear}-${endYearShort}`;
  } else {
    // Apr - Dec
    const startYear = year;
    const endYearShort = String(year + 1).slice(-2);
    return `${startYear}-${endYearShort}`;
  }
}
