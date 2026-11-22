import { getClient } from '../../config/db.js';
import { payrollRepository } from './payroll.repository.js';
import { PAYROLL_STATUS, roundMoney } from './payroll.constants.js';
import { accountingService } from '../accounting/accounting.service.js';

class PayrollService {
  // ============================================================================
  // EMPLOYEES
  // ============================================================================

  async createEmployee(data) {
    const existing = await payrollRepository.findEmployeeByCode(data.employee_code);
    if (existing) {
      const err = new Error(`Employee with code "${data.employee_code}" already exists`);
      err.statusCode = 409;
      throw err;
    }
    return payrollRepository.createEmployee(data);
  }

  async updateEmployee(id, data) {
    const existing = await payrollRepository.findEmployeeById(id);
    if (!existing) {
      const err = new Error(`Employee with ID "${id}" not found`);
      err.statusCode = 404;
      throw err;
    }
    return payrollRepository.updateEmployee(id, data);
  }

  async getEmployees(filters) {
    return payrollRepository.findAllEmployees(filters);
  }

  async getEmployeeById(id) {
    const employee = await payrollRepository.findEmployeeById(id);
    if (!employee) {
      const err = new Error(`Employee with ID "${id}" not found`);
      err.statusCode = 404;
      throw err;
    }
    return employee;
  }

  // ============================================================================
  // PAYROLL RUNS
  // ============================================================================

  async generatePayrollRun(data, user) {
    const existing = await payrollRepository.findPayrollByPeriod(data.payroll_period);
    if (existing) {
      const err = new Error(`Payroll run for period "${data.payroll_period}" already exists`);
      err.statusCode = 409;
      throw err;
    }

    let itemsToProcess = [];

    if (data.items && data.items.length > 0) {
      itemsToProcess = data.items.map((item) => {
        const basic = roundMoney(item.basic_salary);
        const allowances = roundMoney(item.allowances || 0);
        const deductions = roundMoney(item.deductions || 0);
        const net = roundMoney(basic + allowances - deductions);
        return {
          employee_id: item.employee_id,
          basic_salary: basic,
          allowances,
          deductions,
          net_salary: net,
          present_days: item.present_days !== undefined ? item.present_days : 30,
          absent_days: item.absent_days || 0,
          notes: item.notes || null,
        };
      });
    } else {
      const activeEmployees = await payrollRepository.findAllEmployees({ is_active: true });
      if (activeEmployees.length === 0) {
        const err = new Error('No active employees found to generate payroll');
        err.statusCode = 400;
        throw err;
      }

      itemsToProcess = activeEmployees.map((emp) => {
        const basic = roundMoney(emp.base_salary);
        return {
          employee_id: emp.id,
          basic_salary: basic,
          allowances: 0,
          deductions: 0,
          net_salary: basic,
          present_days: 30,
          absent_days: 0,
          notes: null,
        };
      });
    }

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const item of itemsToProcess) {
      totalGross = roundMoney(totalGross + item.basic_salary + item.allowances);
      totalDeductions = roundMoney(totalDeductions + item.deductions);
      totalNet = roundMoney(totalNet + item.net_salary);
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const header = {
        payroll_period: data.payroll_period,
        run_date: data.run_date || new Date().toISOString().split('T')[0],
        total_gross_salary: totalGross,
        total_deductions: totalDeductions,
        total_net_salary: totalNet,
        status: PAYROLL_STATUS.DRAFT,
        created_by: user.id,
      };

      const result = await payrollRepository.createPayrollRun(header, itemsToProcess, client);

      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getPayrollRuns(filters) {
    return payrollRepository.findAllPayrollRuns(filters);
  }

  async getPayrollRunById(id) {
    const run = await payrollRepository.findPayrollById(id);
    if (!run) {
      const err = new Error(`Payroll run with ID "${id}" not found`);
      err.statusCode = 404;
      throw err;
    }
    return run;
  }

  async approvePayrollRun(id, user) {
    const run = await payrollRepository.findPayrollById(id);
    if (!run) {
      const err = new Error(`Payroll run with ID "${id}" not found`);
      err.statusCode = 404;
      throw err;
    }

    if (run.status !== PAYROLL_STATUS.DRAFT) {
      const err = new Error(`Cannot approve payroll run in status "${run.status}". It must be in draft status.`);
      err.statusCode = 400;
      throw err;
    }

    const netSalary = roundMoney(run.total_net_salary);
    if (netSalary <= 0) {
      const err = new Error(`Cannot approve payroll run with zero total net salary`);
      err.statusCode = 400;
      throw err;
    }

    // Update status to approved
    await payrollRepository.updatePayrollRun(id, {
      status: PAYROLL_STATUS.APPROVED,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    });

    // Post Accounting Journal Entry (DR 6100 Salaries Expense, CR 2400 Salaries Payable)
    try {
      await accountingService.createJournalEntry(
        {
          entry_date: run.run_date,
          source_type: 'PAYROLL_RUN',
          source_id: run.id,
          source_reference: run.payroll_period,
          narration: `Accrual of payroll for period ${run.payroll_period}`,
          lines: [
            {
              account_code: '6100', // Salaries & Administrative Wages
              debit_amount: netSalary,
              credit_amount: 0,
              description: `Payroll expense for period ${run.payroll_period}`,
            },
            {
              account_code: '2400', // Salaries & Wages Payable
              debit_amount: 0,
              credit_amount: netSalary,
              description: `Accrued payroll liability for period ${run.payroll_period}`,
            },
          ],
        },
        user
      );
    } catch (journalErr) {
      // Revert approval if journal entry fails
      await payrollRepository.updatePayrollRun(id, {
        status: PAYROLL_STATUS.DRAFT,
        approved_by: null,
        approved_at: null,
      });
      throw journalErr;
    }

    return this.getPayrollRunById(id);
  }

  async payPayrollRun(id, data, user) {
    const run = await payrollRepository.findPayrollById(id);
    if (!run) {
      const err = new Error(`Payroll run with ID "${id}" not found`);
      err.statusCode = 404;
      throw err;
    }

    if (run.status !== PAYROLL_STATUS.APPROVED) {
      const err = new Error(
        `Cannot disburse payment for payroll run in status "${run.status}". It must be approved first.`
      );
      err.statusCode = 400;
      throw err;
    }

    const netSalary = roundMoney(run.total_net_salary);
    const paymentMode = data.payment_mode || 'bank_transfer';
    const creditAccount = paymentMode === 'cash' ? '1110' : '1120';

    // Update status to paid
    await payrollRepository.updatePayrollRun(id, {
      status: PAYROLL_STATUS.PAID,
      payment_mode: paymentMode,
      reference_txn_id: data.reference_txn_id || null,
      paid_at: new Date().toISOString(),
    });

    // Post Accounting Journal Entry (DR 2400 Salaries Payable, CR 1120 Bank / 1110 Cash)
    try {
      await accountingService.createJournalEntry(
        {
          entry_date: data.payment_date || new Date().toISOString().split('T')[0],
          source_type: 'PAYROLL_PAYMENT',
          source_id: run.id,
          source_reference: run.payroll_period,
          narration: `Disbursement of payroll for period ${run.payroll_period} via ${paymentMode}`,
          lines: [
            {
              account_code: '2400', // Salaries & Wages Payable
              debit_amount: netSalary,
              credit_amount: 0,
              description: `Settlement of payroll liability for period ${run.payroll_period}`,
            },
            {
              account_code: creditAccount, // 1120 Bank or 1110 Cash
              debit_amount: 0,
              credit_amount: netSalary,
              description: `Payroll payout for period ${run.payroll_period} via ${paymentMode}`,
            },
          ],
        },
        user
      );
    } catch (journalErr) {
      // Revert payment status if journal fails
      await payrollRepository.updatePayrollRun(id, {
        status: PAYROLL_STATUS.APPROVED,
        payment_mode: null,
        reference_txn_id: null,
        paid_at: null,
      });
      throw journalErr;
    }

    return this.getPayrollRunById(id);
  }
}

export const payrollService = new PayrollService();
