import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authRepository } from './auth.repository.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';

export const authService = {
  /**
   * Authenticate a user by username and password, returns user info and JWT
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{user: object, token: string}>}
   */
  async login(username, password) {
    const user = await authRepository.findByUsername(username);
    if (!user) {
      throw ApiError.unauthorized('Invalid username or password');
    }

    if (!user.is_active) {
      throw ApiError.unauthorized('Account is inactive. Please contact administrator.');
    }

    // Compare password with bcryptjs.
    // Wrap in try/catch to safely handle legacy/placeholder hashes (e.g. Argon2) without crashing
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password_hash);
    } catch {
      isMatch = false;
    }

    if (!isMatch) {
      throw ApiError.unauthorized('Invalid username or password');
    }

    // Sign JWT with subject = user.id and explicit HS256 algorithm
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const token = jwt.sign(payload, env.jwt.secret, {
      algorithm: env.jwt.algorithm || 'HS256',
      expiresIn: env.jwt.expiresIn,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
      },
      token,
    };
  },

  /**
   * Change user password after verifying current password
   * @param {string} userId
   * @param {string} currentPassword
   * @param {string} newPassword
   * @returns {Promise<void>}
   */
  async changePassword(userId, currentPassword, newPassword) {
    if (!newPassword || newPassword.length < 12) {
      throw ApiError.badRequest('New password must be at least 12 characters long');
    }

    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      throw ApiError.badRequest('New password cannot exceed 72 bytes (bcrypt limitation)');
    }

    const user = await authRepository.findWithHashById(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }

    if (!user.is_active) {
      throw ApiError.unauthorized('Account is inactive. Please contact administrator.');
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    } catch {
      isMatch = false;
    }

    if (!isMatch) {
      throw ApiError.badRequest('Current password is incorrect');
    }

    const saltRounds = env.bcrypt.saltRounds;
    const newHash = await bcrypt.hash(newPassword, saltRounds);

    await authRepository.updatePasswordHash(userId, newHash);
  },
};
