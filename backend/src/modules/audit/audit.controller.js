import { auditService } from './audit.service.js';

export const getLogs = async (req, res, next) => {
  try {
    const { page, limit, entity_name, action, user_id, from_date, to_date, search } = req.query;
    const result = await auditService.getLogs({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      entity_name,
      action,
      user_id,
      from_date,
      to_date,
      search,
    });
    res.status(200).json({
      success: true,
      data: result.logs,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getFilters = async (req, res, next) => {
  try {
    const data = await auditService.getFilters();
    res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};
