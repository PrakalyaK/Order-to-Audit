import { payrollService } from './payroll.service.js';

// ============================================================================
// EMPLOYEES
// ============================================================================

export const createEmployee = async (req, res, next) => {
  try {
    const result = await payrollService.createEmployee(req.body);
    res.status(201).json({
      success: true,
      message: 'Employee registered successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const updateEmployee = async (req, res, next) => {
  try {
    const result = await payrollService.updateEmployee(req.params.id, req.body);
    res.status(200).json({
      success: true,
      message: 'Employee updated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getEmployees = async (req, res, next) => {
  try {
    const result = await payrollService.getEmployees(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getEmployeeById = async (req, res, next) => {
  try {
    const result = await payrollService.getEmployeeById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

// ============================================================================
// PAYROLL RUNS
// ============================================================================

export const generatePayrollRun = async (req, res, next) => {
  try {
    const result = await payrollService.generatePayrollRun(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Payroll run generated successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getPayrollRuns = async (req, res, next) => {
  try {
    const result = await payrollService.getPayrollRuns(req.query);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const getPayrollRunById = async (req, res, next) => {
  try {
    const result = await payrollService.getPayrollRunById(req.params.id);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const approvePayrollRun = async (req, res, next) => {
  try {
    const result = await payrollService.approvePayrollRun(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Payroll run approved and journal entry recorded',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const payPayrollRun = async (req, res, next) => {
  try {
    const result = await payrollService.payPayrollRun(req.params.id, req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Payroll disbursement recorded and journal entry posted',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
