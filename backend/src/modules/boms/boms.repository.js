import { query, getClient } from '../../config/db.js';

export const bomsRepository = {
  /**
   * Find paginated BOM headers with finished good details
   */
  async findAll({ page = 1, limit = 20, search, finished_good_item_id, is_active }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(b.bom_code ILIKE $${paramIndex} OR i.name ILIKE $${paramIndex} OR i.sku ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (finished_good_item_id) {
      conditions.push(`b.finished_good_item_id = $${paramIndex}`);
      params.push(finished_good_item_id);
      paramIndex++;
    }

    if (is_active !== undefined) {
      conditions.push(`b.is_active = $${paramIndex}`);
      params.push(is_active);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*) AS total 
      FROM boms b 
      JOIN items i ON b.finished_good_item_id = i.id 
      ${whereClause};
    `;
    const countRes = await query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    const dataSql = `
      SELECT 
        b.id, b.finished_good_item_id, b.bom_code, b.version_number,
        b.standard_batch_size, b.batch_uom_id, b.tolerance_variance_pct,
        b.is_active, b.effective_from, b.effective_to, b.notes,
        b.created_by, b.created_at,
        i.name AS finished_good_name, i.sku AS finished_good_sku,
        u.name AS batch_uom_name,
        (SELECT COUNT(*) FROM bom_items bi WHERE bi.bom_id = b.id) AS material_items_count
      FROM boms b
      JOIN items i ON b.finished_good_item_id = i.id
      JOIN units_of_measure u ON b.batch_uom_id = u.id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    params.push(limit, offset);

    const dataRes = await query(dataSql, params);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      boms: dataRes.rows,
    };
  },

  /**
   * Find BOM by ID including all material items
   */
  async findById(id) {
    const bomSql = `
      SELECT 
        b.id, b.finished_good_item_id, b.bom_code, b.version_number,
        b.standard_batch_size, b.batch_uom_id, b.tolerance_variance_pct,
        b.is_active, b.effective_from, b.effective_to, b.notes,
        b.created_by, b.created_at,
        i.name AS finished_good_name, i.sku AS finished_good_sku, i.base_uom_id AS finished_good_base_uom,
        u.name AS batch_uom_name,
        creator.username AS created_by_username
      FROM boms b
      JOIN items i ON b.finished_good_item_id = i.id
      JOIN units_of_measure u ON b.batch_uom_id = u.id
      JOIN users creator ON b.created_by = creator.id
      WHERE b.id = $1;
    `;
    const bomRes = await query(bomSql, [id]);
    if (bomRes.rows.length === 0) return null;

    const bom = bomRes.rows[0];

    const itemsSql = `
      SELECT 
        bi.id, bi.bom_id, bi.item_id, bi.standard_qty, bi.uom_id, bi.scrap_allowance_pct,
        i.name AS item_name, i.sku AS item_sku, i.item_type, i.base_uom_id AS item_base_uom,
        u.name AS uom_name, u.dimension AS uom_dimension
      FROM bom_items bi
      JOIN items i ON bi.item_id = i.id
      JOIN units_of_measure u ON bi.uom_id = u.id
      WHERE bi.bom_id = $1
      ORDER BY i.name ASC;
    `;
    const itemsRes = await query(itemsSql, [id]);
    bom.materials = itemsRes.rows;

    return bom;
  },

  /**
   * Check if a specific version exists for a finished good
   */
  async findByProductAndVersion(finishedGoodItemId, versionNumber) {
    const text = `
      SELECT id, bom_code, version_number, is_active
      FROM boms
      WHERE finished_good_item_id = $1 AND version_number = $2;
    `;
    const res = await query(text, [finishedGoodItemId, versionNumber]);
    return res.rows[0] || null;
  },

  /**
   * Check if an active BOM exists for a product
   */
  async findActiveByProductId(finishedGoodItemId) {
    const text = `
      SELECT id, bom_code, version_number
      FROM boms
      WHERE finished_good_item_id = $1 AND is_active = true;
    `;
    const res = await query(text, [finishedGoodItemId]);
    return res.rows[0] || null;
  },

  /**
   * Check if BOM has been used in production runs
   */
  async isUsedInProduction(bomId) {
    const text = `
      SELECT 1 FROM production_runs WHERE bom_id = $1 LIMIT 1;
    `;
    const res = await query(text, [bomId]);
    return res.rows.length > 0;
  },

  /**
   * Create BOM with material items inside a transaction
   */
  async createWithMaterials(bomData, materials, client) {
    const dbClient = client || (await getClient());
    const isLocalTransaction = !client;

    try {
      if (isLocalTransaction) await dbClient.query('BEGIN');

      // If this BOM is active, deactivate existing active BOMs for this product first
      if (bomData.is_active) {
        await dbClient.query(
          `UPDATE boms SET is_active = false WHERE finished_good_item_id = $1 AND is_active = true;`,
          [bomData.finished_good_item_id]
        );
      }

      // 1. Insert BOM header
      const bomInsertSql = `
        INSERT INTO boms (
          finished_good_item_id, bom_code, version_number,
          standard_batch_size, batch_uom_id, tolerance_variance_pct,
          is_active, effective_from, effective_to, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *;
      `;
      const bomRes = await dbClient.query(bomInsertSql, [
        bomData.finished_good_item_id,
        bomData.bom_code,
        bomData.version_number,
        bomData.standard_batch_size,
        bomData.batch_uom_id,
        bomData.tolerance_variance_pct ?? 3.00,
        bomData.is_active ?? false,
        bomData.effective_from,
        bomData.effective_to || null,
        bomData.notes || null,
        bomData.created_by,
      ]);
      const createdBom = bomRes.rows[0];

      // 2. Insert material items
      const itemInsertSql = `
        INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
      createdBom.materials = [];
      for (const mat of materials) {
        const itemRes = await dbClient.query(itemInsertSql, [
          createdBom.id,
          mat.item_id,
          mat.standard_qty,
          mat.uom_id,
          mat.scrap_allowance_pct ?? 0.00,
        ]);
        createdBom.materials.push(itemRes.rows[0]);
      }

      if (isLocalTransaction) await dbClient.query('COMMIT');
      return createdBom;
    } catch (err) {
      if (isLocalTransaction) await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      if (isLocalTransaction) dbClient.release();
    }
  },

  /**
   * Update BOM header and conditionally replace materials in a transaction
   */
  async updateWithMaterials(bomId, bomData, materials, client) {
    const dbClient = client || (await getClient());
    const isLocalTransaction = !client;

    try {
      if (isLocalTransaction) await dbClient.query('BEGIN');

      // If setting to active, deactivate other versions
      if (bomData.is_active) {
        const current = await dbClient.query(`SELECT finished_good_item_id FROM boms WHERE id = $1;`, [bomId]);
        if (current.rows.length > 0) {
          await dbClient.query(
            `UPDATE boms SET is_active = false WHERE finished_good_item_id = $1 AND id != $2 AND is_active = true;`,
            [current.rows[0].finished_good_item_id, bomId]
          );
        }
      }

      // Update header fields
      const headerFields = [];
      const values = [];
      let idx = 1;

      for (const [key, val] of Object.entries(bomData)) {
        if (val !== undefined) {
          headerFields.push(`${key} = $${idx}`);
          values.push(val);
          idx++;
        }
      }

      if (headerFields.length > 0) {
        values.push(bomId);
        await dbClient.query(
          `UPDATE boms SET ${headerFields.join(', ')} WHERE id = $${idx};`,
          values
        );
      }

      // If materials provided, replace them
      if (materials && materials.length > 0) {
        await dbClient.query(`DELETE FROM bom_items WHERE bom_id = $1;`, [bomId]);
        const itemInsertSql = `
          INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct)
          VALUES ($1, $2, $3, $4, $5);
        `;
        for (const mat of materials) {
          await dbClient.query(itemInsertSql, [
            bomId,
            mat.item_id,
            mat.standard_qty,
            mat.uom_id,
            mat.scrap_allowance_pct ?? 0.00,
          ]);
        }
      }

      if (isLocalTransaction) await dbClient.query('COMMIT');
      return true;
    } catch (err) {
      if (isLocalTransaction) await dbClient.query('ROLLBACK');
      throw err;
    } finally {
      if (isLocalTransaction) dbClient.release();
    }
  },

  /**
   * Set active status for a BOM
   */
  async setStatus(bomId, isActive) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const bom = await client.query(`SELECT id, finished_good_item_id FROM boms WHERE id = $1;`, [bomId]);
      if (bom.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      if (isActive) {
        // Deactivate other versions of the same product
        await client.query(
          `UPDATE boms SET is_active = false WHERE finished_good_item_id = $1 AND id != $2 AND is_active = true;`,
          [bom.rows[0].finished_good_item_id, bomId]
        );
      }

      const res = await client.query(
        `UPDATE boms SET is_active = $1 WHERE id = $2 RETURNING id, bom_code, version_number, is_active;`,
        [isActive, bomId]
      );

      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
