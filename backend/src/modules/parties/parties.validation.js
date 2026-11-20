import { z } from 'zod';
import { ALL_PARTY_TYPES } from './parties.constants.js';

// GSTIN format: 2-digit state code + 10-char PAN + 1-char entity number + 'Z' + 1 checksum char
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const createPartySchema = z.object({
  party_type: z.enum(ALL_PARTY_TYPES, {
    required_error: `party_type is required and must be one of: ${ALL_PARTY_TYPES.join(', ')}`,
  }),
  trade_name: z
    .string({ required_error: 'Trade name is required' })
    .trim()
    .min(1, 'Trade name cannot be empty')
    .max(150, 'Trade name cannot exceed 150 characters'),
  contact_person: z
    .string()
    .trim()
    .max(100, 'Contact person cannot exceed 100 characters')
    .optional(),
  phone: z
    .string({ required_error: 'Phone number is required' })
    .trim()
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number cannot exceed 20 characters'),
  email: z
    .string()
    .trim()
    .email('Invalid email address')
    .max(100)
    .optional()
    .or(z.literal('')),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Invalid GSTIN format (must be 15 characters, e.g. 33AAAAA0000A1Z5)')
    .optional()
    .or(z.literal('')),
  state_code: z
    .string({ required_error: '2-digit State code is required' })
    .trim()
    .length(2, 'State code must be exactly 2 digits (e.g. 33 for Tamil Nadu, 29 for Karnataka)')
    .regex(/^[0-9]{2}$/, 'State code must be numeric digits'),
  state_name: z
    .string({ required_error: 'State name is required' })
    .trim()
    .min(1, 'State name cannot be empty')
    .max(50, 'State name cannot exceed 50 characters'),
  billing_address: z
    .string({ required_error: 'Billing address is required' })
    .trim()
    .min(1, 'Billing address cannot be empty'),
  shipping_address: z
    .string()
    .trim()
    .optional(),
  credit_limit: z
    .number()
    .min(0, 'Credit limit cannot be negative')
    .default(0.00),
  payment_terms_days: z
    .number()
    .int()
    .min(0, 'Payment terms days cannot be negative')
    .default(30),
  is_active: z.boolean().default(true),
}).refine(
  (data) => {
    // If GSTIN is provided, verify first 2 digits match state_code
    if (data.gstin && data.gstin.length === 15) {
      return data.gstin.substring(0, 2) === data.state_code;
    }
    return true;
  },
  {
    message: 'GSTIN state code prefix does not match the specified state_code',
    path: ['gstin'],
  }
);

export const updatePartySchema = z.object({
  party_type: z.enum(ALL_PARTY_TYPES).optional(),
  trade_name: z.string().trim().min(1).max(150).optional(),
  contact_person: z.string().trim().max(100).optional(),
  phone: z.string().trim().min(10).max(20).optional(),
  email: z.string().trim().email().max(100).optional().or(z.literal('')),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN format').optional().or(z.literal('')),
  state_code: z.string().trim().length(2).regex(/^[0-9]{2}$/).optional(),
  state_name: z.string().trim().min(1).max(50).optional(),
  billing_address: z.string().trim().min(1).optional(),
  shipping_address: z.string().trim().optional(),
  credit_limit: z.number().min(0).optional(),
  payment_terms_days: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.gstin && data.state_code) {
      return data.gstin.substring(0, 2) === data.state_code;
    }
    return true;
  },
  {
    message: 'GSTIN state code prefix does not match the specified state_code',
    path: ['gstin'],
  }
);

export const setPartyStatusSchema = z.object({
  is_active: z.boolean({ required_error: 'is_active boolean is required' }),
});

export const queryPartiesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  party_type: z.enum(ALL_PARTY_TYPES).optional(),
  is_active: z.preprocess((val) => (val === 'true' ? true : val === 'false' ? false : val), z.boolean().optional()),
  state_code: z.string().trim().optional(),
});
