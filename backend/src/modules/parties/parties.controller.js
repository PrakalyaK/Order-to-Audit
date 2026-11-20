import { asyncHandler } from '../../utils/asyncHandler.js';
import { partiesService } from './parties.service.js';

export const getAll = asyncHandler(async (req, res) => {
  const result = await partiesService.getParties(req.query);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const party = await partiesService.getPartyById(req.params.id);
  res.status(200).json({
    success: true,
    data: { party },
  });
});

export const create = asyncHandler(async (req, res) => {
  const created = await partiesService.createParty(req.body);
  res.status(201).json({
    success: true,
    message: 'Party created successfully',
    data: { party: created },
  });
});

export const update = asyncHandler(async (req, res) => {
  const updated = await partiesService.updateParty(req.params.id, req.body);
  res.status(200).json({
    success: true,
    message: 'Party updated successfully',
    data: { party: updated },
  });
});

export const setStatus = asyncHandler(async (req, res) => {
  const updated = await partiesService.setPartyStatus(req.params.id, req.body.is_active);
  res.status(200).json({
    success: true,
    message: `Party ${req.body.is_active ? 'activated' : 'deactivated'} successfully`,
    data: { party: updated },
  });
});
