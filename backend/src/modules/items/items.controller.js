import { asyncHandler } from '../../utils/asyncHandler.js';
import { itemsService } from './items.service.js';

export const getAll = asyncHandler(async (req, res) => {
  const result = await itemsService.getItems(req.query);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const item = await itemsService.getItemById(req.params.id);
  res.status(200).json({
    success: true,
    data: { item },
  });
});

export const create = asyncHandler(async (req, res) => {
  const created = await itemsService.createItem(req.body);
  res.status(201).json({
    success: true,
    message: 'Item created successfully',
    data: { item: created },
  });
});

export const update = asyncHandler(async (req, res) => {
  const updated = await itemsService.updateItem(req.params.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Item updated successfully',
    data: { item: updated },
  });
});

export const setStatus = asyncHandler(async (req, res) => {
  const updated = await itemsService.setItemStatus(req.params.id, req.body.is_active);
  res.status(200).json({
    success: true,
    message: `Item ${req.body.is_active ? 'activated' : 'deactivated'} successfully`,
    data: { item: updated },
  });
});
