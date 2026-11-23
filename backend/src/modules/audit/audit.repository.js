import { query } from '../../config/db.js';

export const auditRepository = {
  /**
   * Find audit logs with search, filtering, and pagination
   */
  async findLogs({ page = 1, limit = 50, entity_name, action, user_id, from_date, to_date, search }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (entity_name) {
      conditions.push(`al.entity_name = $${paramIndex}`);
      params.push(entity_name);
      paramIndex++;
    }

    if (action) {
      conditions.push(`al.action = $${paramIndex}`);
      params.push(action);
      paramIndex++;
    }

    if (user_id) {
      conditions.push(`al.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (from_date) {
      conditions.push(`al.created_at >= $${paramIndex}`);
      params.push(from_date);
      paramIndex++;
    }

    if (to_date) {
      conditions.push(`al.created_at <= $${paramIndex}`);
      params.push(to_date);
      paramIndex++;
    }

    if (search) {
      conditions.push(`(al.entity_id ILIKE $${paramIndex} OR al.action ILIKE $${paramIndex} OR al.entity_name ILIKE $${paramIndex} OR u.username ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*) AS total
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause};
    `;
    const countRes = await query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    const dataSql = `
      SELECT 
        al.id,
        al.user_id,
        u.username,
        u.full_name AS user_full_name,
        u.role AS user_role,
        al.action,
        al.entity_name,
        al.entity_id,
        al.old_values,
        al.new_values,
        al.ip_address,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.id DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;

    const dataRes = await query(dataSql, [...params, limit, offset]);

    return {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
      logs: dataRes.rows,
    };
  },

  async getEntities() {
    const res = await query('SELECT DISTINCT entity_name FROM audit_logs WHERE entity_name IS NOT NULL ORDER BY entity_name');
    return res.rows.map((r) => r.entity_name);
  },

  async getActions() {
    const res = await query('SELECT DISTINCT action FROM audit_logs WHERE action IS NOT NULL ORDER BY action');
    return res.rows.map((r) => r.action);
  },
};
