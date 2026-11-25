export const FULFILMENT_STATUS = {
  READY_TO_DISPATCH: 'ready_to_dispatch',
  STOCK_SHORTAGE: 'stock_shortage',
  PARTIALLY_AVAILABLE: 'partially_available',
  FULFILLED: 'fulfilled',
};

export const PRODUCTION_REQUIREMENT_STATUS = {
  PENDING_REVIEW: 'pending_production_review',
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  AWAITING_MATERIALS: 'awaiting_materials',
  IN_PRODUCTION: 'in_production',
  PARTIALLY_FULFILLED: 'partially_fulfilled',
  FULFILLED: 'fulfilled',
  PRODUCTION_COMPLETED: 'production_completed',
  CANCELLED: 'cancelled',
};

export const PROCUREMENT_REQUIREMENT_STATUS = {
  PENDING: 'pending',
  ORDERED: 'ordered',
  RECEIVED: 'received',
  CANCELLED: 'cancelled',
};
