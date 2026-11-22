import { z } from 'zod';

export const createEmployeeSchema = z.object({
  employee_code: z
    .string({ required_error: 'employee_code is required' })
    .trim()
    .min(2)
    .max(20),
  full_name: z
    .string({ required_error: 'full_name is required' })
    .trim()
    .min(2)
    .max(100),
  department: z
    .string({ required_error: 'department is required' })
    .trim()
    .min(2)
    .max(50),
  designation: z
    .string({ required_error: 'designation is required' })
    .trim()
    .min(2)
    .max(50),
  joining_date: z
    .string({ required_error: 'joining_date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  base_salary: z.coerce
    .number({ required_error: 'base_salary is required' })
    .positive('base_salary must be strictly greater than 0'),
  bank_account_number: z.string().trim().max(50).optional().nullable(),
  bank_ifsc: z.string().trim().max(20).optional().nullable(),
  pan_number: z.string().trim().max(20).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const updateEmployeeSchema = z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  department: z.string().trim().min(2).max(50).optional(),
  designation: z.string().trim().min(2).max(50).optional(),
  base_salary: z.coerce.number().positive().optional(),
  bank_account_number: z.string().trim().max(50).optional().nullable(),
  bank_ifsc: z.string().trim().max(20).optional().nullable(),
  pan_number: z.string().trim().max(20).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const generatePayrollSchema = z.object({
  payroll_period: z
    .string({ required_error: 'payroll_period is required' })
    .regex(/^\d{4}-\d{2}$/, 'payroll_period must be in YYYY-MM format'),
  run_date: z
    .string({ required_error: 'run_date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'run_date must be in YYYY-MM-DD format'),
  items: z.array(z.object({
    employee_id: z.string().uuid(),
    basic_salary: z.coerce.number().positive(),
    allowances: z.coerce.number().min(0).default(0),
    deductions: z.coerce.number().min(0).default(0),
    present_days: z.coerce.number().int().min(0).max(31).default(30),
    absent_days: z.coerce.number().int().min(0).max(31).default(0),
    notes: z.string().trim().max(255).optional().nullable(),
  })).optional(),
});

export const payPayrollSchema = z.object({
  payment_mode: z.enum(['bank_transfer', 'cheque', 'cash']).default('bank_transfer'),
  reference_txn_id: z.string().trim().max(100).optional().nullable(),
});
