import { asyncHandler } from '../../utils/asyncHandler.js';
import { bomsService } from './boms.service.js';

export const getAll = asyncHandler(async (req, res) => {
  const result = await bomsService.getBoms(req.query);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const bom = await bomsService.getBomById(req.params.id);
  res.status(200).json({
    success: true,
    data: { bom },
  });
});

export const create = asyncHandler(async (req, res) => {
  const created = await bomsService.createBom(req.body, req.user.id);
  res.status(201).json({
    success: true,
    message: 'Bill of Materials (BOM) created successfully',
    data: { bom: created },
  });
});

export const update = asyncHandler(async (req, res) => {
  const updated = await bomsService.updateBom(req.params.id, req.body, req.user.id);
  res.status(200).json({
    success: true,
    message: 'Bill of Materials (BOM) updated successfully',
    data: { bom: updated },
  });
});

export const setStatus = asyncHandler(async (req, res) => {
  const updated = await bomsService.setBomStatus(req.params.id, req.body.is_active);
  res.status(200).json({
    success: true,
    message: `BOM ${req.body.is_active ? 'activated' : 'deactivated'} successfully`,
    data: { bom: updated },
  });
});

export const calculateRequirements = asyncHandler(async (req, res) => {
  const { requested_output_qty, output_uom_id } = req.body;
  const result = await bomsService.calculateRequirements(req.params.id, requested_output_qty, output_uom_id);
  res.status(200).json({
    success: true,
    data: result,
  });
});
