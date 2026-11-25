import { asyncHandler } from '../../utils/asyncHandler.js';
import { fulfilmentService } from './fulfilment.service.js';

export const getDashboard = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.getFulfilmentDashboard(req.query, req.user);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getOrderFulfilment = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.getSalesOrderFulfilment(req.params.id, req.user);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const evaluateOrder = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.evaluateSalesOrder(req.params.id);
  res.status(200).json({
    success: true,
    message: 'Sales order fulfilment evaluated successfully',
    data: result,
  });
});

export const dispatchOrder = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.dispatchFulfilmentOrder(req.params.id, req.body, req.user);
  res.status(200).json({
    success: true,
    message: 'Dispatch processed successfully with inventory and ledger posting',
    data: result,
  });
});

export const getProductionRequirements = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.getProductionRequirements(req.query, req.user);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const getProductionRequirementDetails = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.getProductionRequirementDetails(req.params.id, req.user);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const raiseProcurementRequirement = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.raiseProcurementRequirement(req.params.id, req.body, req.user);
  res.status(201).json({
    success: true,
    message: 'Procurement requirement raised successfully',
    data: result,
  });
});

export const initiateProductionRun = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.initiateProductionRun(req.params.id, req.body, req.user);
  res.status(201).json({
    success: true,
    message: result.message,
    data: result,
  });
});

// Notifications
export const getNotifications = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.getNotifications(req.user, req.query.limit);
  res.status(200).json({
    success: true,
    data: result,
  });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.markNotificationRead(req.params.id);
  res.status(200).json({
    success: true,
    message: 'Notification marked as read',
    data: result,
  });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const result = await fulfilmentService.markAllNotificationsRead(req.user);
  res.status(200).json({
    success: true,
    message: 'All notifications marked as read',
    data: result,
  });
});

