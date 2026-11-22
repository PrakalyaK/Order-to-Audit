import { query } from '../../config/db.js';
import { roundMoney, TRANSFER_STATUS } from './warehouses.constants.js';

class WarehousesRepository {
  async findAllWarehouses(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.is_active !== undefined) {
      values.push(filters.is_active === 'true' || filters.is_active === true);
      conditions.push(`is_active = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM warehouses
      ${whereClause}
      ORDER BY is_primary DESC, warehouse_code ASC
    `;

    const res = await db.query(sql, values);
    return res.rows;
  }

  async findWarehouseById(id, client = null) {
    const db = client || { query };
    const res = await db.query(`SELECT * FROM warehouses WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }

  async findWarehouseByCode(code, client = null) {
    const db = client || { query };
    const res = await db.query(`SELECT * FROM warehouses WHERE warehouse_code = $1`, [code]);
    return res.rows[0] || null;
  }

  async createWarehouse(data, client = null) {
    const db = client || { query };
    const res = await db.query(
      `INSERT INTO warehouses (
        warehouse_code,
        name,
        address,
        city,
        state_code,
        is_primary,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        data.warehouse_code,
        data.name,
        data.address || null,
        data.city || null,
        data.state_code || null,
        data.is_primary || false,
        data.is_active !== undefined ? data.is_active : true,
      ]
    );
    return res.rows[0];
  }

  async updateWarehouse(id, data, client = null) {
    const db = client || { query };
    const fields = [];
    const values = [];

    if (data.name !== undefined) {
      values.push(data.name);
      fields.push(`name = $${values.length}`);
    }
    if (data.address !== undefined) {
      values.push(data.address);
      fields.push(`address = $${values.length}`);
    }
    if (data.city !== undefined) {
      values.push(data.city);
      fields.push(`city = $${values.length}`);
    }
    if (data.state_code !== undefined) {
      values.push(data.state_code);
      fields.push(`state_code = $${values.length}`);
    }
    if (data.is_active !== undefined) {
      values.push(data.is_active);
      fields.push(`is_active = $${values.length}`);
    }

    if (fields.length === 0) return this.findWarehouseById(id, client);

    values.push(id);
    const sql = `
      UPDATE warehouses
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const res = await db.query(sql, values);
    return res.rows[0] || null;
  }

  async getWarehouseStock(warehouseId, client = null) {
    const db = client || { query };
    const res = await db.query(
      `SELECT * FROM v_warehouse_stock 
       WHERE warehouse_id = $1 AND current_stock_qty > 0 
       ORDER BY item_type, sku`,
      [warehouseId]
    );
    return res.rows;
  }

  async getWarehouseValuation(warehouseId, client = null) {
    const db = client || { query };
    const res = await db.query(
      `SELECT 
        warehouse_id,
        warehouse_code,
        warehouse_name,
        COUNT(DISTINCT item_id)::int AS items_in_stock,
        COALESCE(SUM(current_stock_qty), 0.0000) AS total_units,
        COALESCE(SUM(warehouse_stock_valuation), 0.00) AS total_valuation
       FROM v_warehouse_stock
       WHERE warehouse_id = $1
       GROUP BY warehouse_id, warehouse_code, warehouse_name`,
      [warehouseId]
    );
    return res.rows[0] || null;
  }

  // ============================================================================
  // TRANSFERS
  // ============================================================================

  async generateTransferNumber(transferDate, client = null) {
    const db = client || { query };
    const dateObj = transferDate ? new Date(transferDate) : new Date();
    const year = dateObj.getFullYear();
    const prefix = `TRF-${year}-`;

    const res = await db.query(
      `SELECT transfer_number 
       FROM warehouse_transfers 
       WHERE transfer_number LIKE $1 
       ORDER BY transfer_number DESC 
       LIMIT 1 FOR UPDATE`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].transfer_number.match(/\d+$/);
      if (match) {
        nextSeq = parseInt(match[0], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  async createTransfer(header, items, client) {
    const db = client || { query };

    const trfRes = await db.query(
      `INSERT INTO warehouse_transfers (
        transfer_number,
        source_warehouse_id,
        destination_warehouse_id,
        transfer_date,
        status,
        requested_by,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        header.transfer_number,
        header.source_warehouse_id,
        header.destination_warehouse_id,
        header.transfer_date,
        header.status || TRANSFER_STATUS.REQUESTED,
        header.requested_by,
        header.notes || null,
      ]
    );

    const transfer = trfRes.rows[0];
    const insertedItems = [];

    for (const item of items) {
      const itemRes = await db.query(
        `INSERT INTO warehouse_transfer_items (
          transfer_id,
          item_id,
          batch_number,
          requested_qty,
          uom_id,
          base_quantity,
          unit_cost,
          total_cost
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          transfer.id,
          item.item_id,
          item.batch_number || null,
          item.requested_qty,
          item.uom_id,
          item.base_quantity,
          item.unit_cost || 0,
          item.total_cost || 0,
        ]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    return {
      ...transfer,
      items: insertedItems,
    };
  }

  async findTransferById(id, client = null) {
    const db = client || { query };
    const trfRes = await db.query(
      `SELECT 
        wt.*,
        w_src.warehouse_code AS source_warehouse_code,
        w_src.name AS source_warehouse_name,
        w_dest.warehouse_code AS destination_warehouse_code,
        w_dest.name AS destination_warehouse_name,
        u_req.username AS requested_by_username,
        u_app.username AS approved_by_username,
        u_disp.username AS dispatched_by_username,
        u_rec.username AS received_by_username
      FROM warehouse_transfers wt
      JOIN warehouses w_src ON wt.source_warehouse_id = w_src.id
      JOIN warehouses w_dest ON wt.destination_warehouse_id = w_dest.id
      JOIN users u_req ON wt.requested_by = u_req.id
      LEFT JOIN users u_app ON wt.approved_by = u_app.id
      LEFT JOIN users u_disp ON wt.dispatched_by = u_disp.id
      LEFT JOIN users u_rec ON wt.received_by = u_rec.id
      WHERE wt.id = $1`,
      [id]
    );

    if (trfRes.rows.length === 0) return null;
    const transfer = trfRes.rows[0];

    const itemsRes = await db.query(
      `SELECT 
        wti.*,
        i.sku,
        i.name AS item_name,
        i.item_type
      FROM warehouse_transfer_items wti
      JOIN items i ON wti.item_id = i.id
      WHERE wti.transfer_id = $1`,
      [id]
    );

    return {
      ...transfer,
      items: itemsRes.rows,
    };
  }

  async findTransfers(filters = {}, client = null) {
    const db = client || { query };
    const conditions = [];
    const values = [];

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`wt.status = $${values.length}`);
    }
    if (filters.source_warehouse_id) {
      values.push(filters.source_warehouse_id);
      conditions.push(`wt.source_warehouse_id = $${values.length}`);
    }
    if (filters.destination_warehouse_id) {
      values.push(filters.destination_warehouse_id);
      conditions.push(`wt.destination_warehouse_id = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS total FROM warehouse_transfers wt ${whereClause}`,
      values
    );
    const total = countRes.rows[0].total;

    const limit = parseInt(filters.limit, 10) || 20;
    const page = parseInt(filters.page, 10) || 1;
    const offset = (page - 1) * limit;

    values.push(limit, offset);
    const sql = `
      SELECT 
        wt.*,
        w_src.warehouse_code AS source_warehouse_code,
        w_src.name AS source_warehouse_name,
        w_dest.warehouse_code AS destination_warehouse_code,
        w_dest.name AS destination_warehouse_name,
        u.username AS requested_by_username,
        (SELECT COUNT(*)::int FROM warehouse_transfer_items WHERE transfer_id = wt.id) AS item_count
      FROM warehouse_transfers wt
      JOIN warehouses w_src ON wt.source_warehouse_id = w_src.id
      JOIN warehouses w_dest ON wt.destination_warehouse_id = w_dest.id
      JOIN users u ON wt.requested_by = u.id
      ${whereClause}
      ORDER BY wt.transfer_date DESC, wt.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `;

    const rowsRes = await db.query(sql, values);

    return {
      transfers: rowsRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}

export const warehousesRepository = new WarehousesRepository();
