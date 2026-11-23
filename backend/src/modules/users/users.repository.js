import { query } from '../../config/db.js';

export const usersRepository = {
  async findAll() {
    const res = await query(`
      SELECT id, username, role, full_name, phone, is_active, created_at, updated_at
      FROM users
      ORDER BY full_name ASC, username ASC;
    `);
    return res.rows;
  },

  async findById(id) {
    const res = await query(`
      SELECT id, username, role, full_name, phone, is_active, created_at, updated_at
      FROM users
      WHERE id = $1;
    `, [id]);
    return res.rows[0] || null;
  },
};
