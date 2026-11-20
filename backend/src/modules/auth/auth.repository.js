import { query } from '../../config/db.js';

export const authRepository = {
  /**
   * Find user by username including password_hash for authentication
   * @param {string} username
   * @returns {Promise<object|null>}
   */
  async findByUsername(username) {
    const text = `
      SELECT id, username, password_hash, full_name, phone, role, is_active, created_at, updated_at
      FROM users
      WHERE username = $1;
    `;
    const res = await query(text, [username]);
    return res.rows[0] || null;
  },

  /**
   * Find user by ID without password_hash (safe for attaching to req.user)
   * @param {string} id - UUID
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    const text = `
      SELECT id, username, full_name, phone, role, is_active, created_at, updated_at
      FROM users
      WHERE id = $1;
    `;
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  /**
   * Find user by ID including password_hash (for password verification/change)
   * @param {string} id - UUID
   * @returns {Promise<object|null>}
   */
  async findWithHashById(id) {
    const text = `
      SELECT id, username, password_hash, full_name, phone, role, is_active, created_at, updated_at
      FROM users
      WHERE id = $1;
    `;
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  /**
   * Update a user's password hash
   * @param {string} userId - UUID
   * @param {string} passwordHash - bcrypt hash
   * @returns {Promise<object|null>}
   */
  async updatePasswordHash(userId, passwordHash) {
    const text = `
      UPDATE users
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, username, full_name, role, is_active, updated_at;
    `;
    const res = await query(text, [passwordHash, userId]);
    return res.rows[0] || null;
  },

  /**
   * Set user active status (useful for administration & testing)
   * @param {string} userId - UUID
   * @param {boolean} isActive
   * @returns {Promise<object|null>}
   */
  async setActiveStatus(userId, isActive) {
    const text = `
      UPDATE users
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, username, is_active;
    `;
    const res = await query(text, [isActive, userId]);
    return res.rows[0] || null;
  },
};
