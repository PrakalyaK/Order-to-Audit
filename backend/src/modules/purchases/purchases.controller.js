import { asyncHandler } from '../../utils/asyncHandler.js';
import { purchasesService } from './purchases.service.js';

export const getAll = asyncHandler(async (req, res) => {
  const result = await purchasesService.getPurchases(req.query);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const purchase = await purchasesService.getPurchaseById(req.params.id);
  res.status(200).json({
    success: true,
    data: { purchase },
  });
});

export const create = asyncHandler(async (req, res) => {
  const created = await purchasesService.createPurchase(req.body, req.user.id);
  res.status(201).json({
    success: true,
    message: 'Purchase bill created successfully (draft)',
    data: { purchase: created },
  });
});

export const update = asyncHandler(async (req, res) => {
  const updated = await purchasesService.updatePurchase(req.params.id, req.body, req.user.id);
  res.status(200).json({
    success: true,
    message: 'Purchase bill updated successfully',
    data: { purchase: updated },
  });
});

export const receive = asyncHandler(async (req, res) => {
  const received = await purchasesService.receivePurchase(req.params.id, req.user.id);
  res.status(200).json({
    success: true,
    message: 'Purchase bill received and inventory stock posted successfully',
    data: { purchase: received },
  });
});

export const cancel = asyncHandler(async (req, res) => {
  const cancelled = await purchasesService.cancelPurchase(req.params.id, req.user.id);
  res.status(200).json({
    success: true,
    message: 'Purchase bill cancelled successfully',
    data: { purchase: cancelled },
  });
});
