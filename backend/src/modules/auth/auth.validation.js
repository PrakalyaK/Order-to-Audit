import { z } from 'zod';

const passwordByteLimit = (val) => Buffer.byteLength(val, 'utf8') <= 72;

export const loginSchema = z.object({
  username: z
    .string({ required_error: 'Username is required' })
    .trim()
    .min(1, 'Username cannot be empty')
    .max(50, 'Username cannot exceed 50 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password cannot be empty')
    .max(72, 'Password cannot exceed 72 characters')
    .refine(passwordByteLimit, {
      message: 'Password cannot exceed 72 bytes (bcrypt limitation)',
    }),
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: 'Current password is required' })
    .min(1, 'Current password cannot be empty')
    .max(72, 'Current password cannot exceed 72 characters')
    .refine(passwordByteLimit, {
      message: 'Current password cannot exceed 72 bytes (bcrypt limitation)',
    }),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(12, 'New password must be at least 12 characters long')
    .max(72, 'New password cannot exceed 72 characters')
    .refine(passwordByteLimit, {
      message: 'New password cannot exceed 72 bytes (bcrypt limitation)',
    }),
});
