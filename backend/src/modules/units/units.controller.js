import { asyncHandler } from '../../utils/asyncHandler.js';
import { unitsService } from './units.service.js';

export const getAll = asyncHandler(async (req, res) => {
  const units = await unitsService.getAllUnits();
  res.status(200).json({
    success: true,
    data: { units },
  });
});

export const getById = asyncHandler(async (req, res) => {
  const unit = await unitsService.getUnitById(req.params.id);
  res.status(200).json({
    success: true,
    data: { unit },
  });
});

export const create = asyncHandler(async (req, res) => {
  const created = await unitsService.createUnit(req.body);
  res.status(201).json({
    success: true,
    message: 'Unit of measure created successfully',
    data: { unit: created },
  });
});

export const validateConversion = asyncHandler(async (req, res) => {
  const { itemId, quantity, uomId } = req.body;
  const result = await unitsService.validateAndConvert(itemId, quantity, uomId);
  res.status(200).json({
    success: true,
    data: result,
  });
});
