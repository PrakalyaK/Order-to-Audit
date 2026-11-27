import { query, getClient } from '../../config/db.js';

export const productionRepository = {
  /**
   * Find paginated list of production runs
   */
  async findAll({ page = 1, limit = 20, status, finished_good_item_id, bom_id, from_date, to_date }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`pr.status = $${paramIndex++}`);
      params.push(status);
    }
    if (finished_good_item_id) {
      conditions.push(`pr.finished_good_item_id = $${paramIndex++}`);
      params.push(finished_good_item_id);
    }
    if (bom_id) {
      conditions.push(`pr.bom_id = $${paramIndex++}`);
      params.push(bom_id);
    }
    if (from_date) {
      conditions.push(`pr.run_date >= $${paramIndex++}`);
      params.push(from_date);
    }
    if (to_date) {
      conditions.push(`pr.run_date <= $${paramIndex++}`);
      params.push(to_date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM production_runs pr ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0].total;

    const dataSql = `
      SELECT 
        pr.id,
        pr.run_number,
        pr.bom_id,
        pr.finished_good_item_id,
        pr.output_batch_number,
        pr.run_date,
        pr.planned_batch_count,
        pr.standard_batch_size,
        pr.planned_yield_qty,
        pr.actual_good_output_qty,
        pr.actual_scrap_output_qty,
        pr.yield_variance_qty,
        pr.yield_variance_pct,
        pr.is_yield_flagged,
        pr.status,
        pr.supervisor_id,
        pr.notes,
        pr.created_at,
        b.bom_code,
        b.version_number AS bom_version,
        b.tolerance_variance_pct,
        fg.sku AS finished_good_sku,
        fg.name AS finished_good_name,
        fg.base_uom_id AS finished_good_uom,
        fg.image_url AS finished_good_image_url,
        u.username AS supervisor_username,
        u.full_name AS supervisor_name,
        (SELECT COUNT(*)::int FROM production_run_inputs pri WHERE pri.production_run_id = pr.id) AS input_items_count
      FROM production_runs pr
      JOIN boms b ON pr.bom_id = b.id
      JOIN items fg ON pr.finished_good_item_id = fg.id
      JOIN users u ON pr.supervisor_id = u.id
      ${whereClause}
      ORDER BY pr.run_date DESC, pr.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;
    params.push(limit, offset);

    const dataRes = await query(dataSql, params);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      data: dataRes.rows,
    };
  },

  /**
   * Find production run by ID with all details (inputs, overheads, costing)
   */
  async findById(id) {
    const runSql = `
      SELECT 
        pr.id,
        pr.run_number,
        pr.bom_id,
        pr.finished_good_item_id,
        pr.output_batch_number,
        pr.run_date,
        pr.planned_batch_count,
        pr.standard_batch_size,
        pr.planned_yield_qty,
        pr.actual_good_output_qty,
        pr.actual_scrap_output_qty,
        pr.yield_variance_qty,
        pr.yield_variance_pct,
        pr.is_yield_flagged,
        pr.status,
        pr.supervisor_id,
        pr.notes,
        pr.created_at,
        b.bom_code,
        b.version_number AS bom_version,
        b.tolerance_variance_pct,
        fg.sku AS finished_good_sku,
        fg.name AS finished_good_name,
        fg.base_uom_id AS finished_good_uom,
        fg.image_url AS finished_good_image_url,
        u.username AS supervisor_username,
        u.full_name AS supervisor_name
      FROM production_runs pr
      JOIN boms b ON pr.bom_id = b.id
      JOIN items fg ON pr.finished_good_item_id = fg.id
      JOIN users u ON pr.supervisor_id = u.id
      WHERE pr.id = $1;
    `;
    const runRes = await query(runSql, [id]);
    if (runRes.rows.length === 0) return null;

    const run = runRes.rows[0];

    // Inputs
    const inputsSql = `
      SELECT 
        pri.id,
        pri.production_run_id,
        pri.item_id,
        pri.planned_qty,
        pri.actual_issued_qty,
        COALESCE(pri.base_net_consumed_qty, pri.good_production_qty + pri.damaged_or_scrap_qty, pri.actual_issued_qty) AS actual_consumed_qty,
        pri.good_production_qty,
        pri.damaged_or_scrap_qty,
        pri.returned_to_store_qty,
        pri.uom_id,
        pri.base_net_consumed_qty,
        pri.unit_cost_applied,
        pri.total_material_cost,
        pri.consumption_variance_qty,
        pri.consumption_variance_pct,
        pri.is_consumption_flagged,
        i.sku AS item_sku,
        i.name AS item_name,
        i.item_type,
        i.base_uom_id AS item_base_uom
      FROM production_run_inputs pri
      JOIN items i ON pri.item_id = i.id
      WHERE pri.production_run_id = $1
      ORDER BY i.item_type DESC, i.name ASC;
    `;
    const inputsRes = await query(inputsSql, [id]);
    run.inputs = inputsRes.rows;

    // Overheads
    const overheadsSql = `
      SELECT id, production_run_id, overhead_type, description, amount
      FROM production_run_overheads
      WHERE production_run_id = $1
      ORDER BY overhead_type, id;
    `;
    const overheadsRes = await query(overheadsSql, [id]);
    run.overheads = overheadsRes.rows;

    // Costing (if completed)
    const costingSql = `
      SELECT 
        production_run_id,
        total_raw_material_cost,
        total_packaging_cost,
        total_direct_overhead_cost,
        gross_total_batch_cost,
        good_output_units,
        cost_per_packet,
        selling_price_per_packet,
        unit_gross_margin,
        gross_margin_pct,
        valuation_method_used,
        calculated_at
      FROM production_run_costing
      WHERE production_run_id = $1;
    `;
    const costingRes = await query(costingSql, [id]);
    run.costing = costingRes.rows[0] || null;

    return run;
  },

  /**
   * Find production run by run_number
   */
  async findByRunNumber(runNumber) {
    const res = await query('SELECT * FROM production_runs WHERE run_number = $1', [runNumber]);
    return res.rows[0] || null;
  },

  /**
   * Generate next sequential run number: PR-YYYY-MM-XXX
   */
  async generateRunNumber(runDate, client = null) {
    const dateObj = runDate ? new Date(runDate) : new Date();
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const prefix = `PR-${year}-${month}-`;

    const runner = client || { query };
    const res = await runner.query(
      `SELECT run_number FROM production_runs WHERE run_number LIKE $1 ORDER BY run_number DESC LIMIT 1;`,
      [`${prefix}%`]
    );

    let nextSeq = 1;
    if (res.rows.length > 0) {
      const match = res.rows[0].run_number.match(new RegExp(`^PR-${year}-${month}-(\\d+)$`));
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(3, '0')}`;
  },

  /**
   * Create production run with input items in a transaction
   */
  async createWithInputs(runData, inputItems, client = null) {
    const shouldManageClient = !client;
    const activeClient = client || (await getClient());

    try {
      if (shouldManageClient) await activeClient.query('BEGIN');

      const runSql = `
        INSERT INTO production_runs (
          run_number,
          bom_id,
          finished_good_item_id,
          output_batch_number,
          run_date,
          planned_batch_count,
          standard_batch_size,
          planned_yield_qty,
          actual_good_output_qty,
          actual_scrap_output_qty,
          yield_variance_pct,
          is_yield_flagged,
          status,
          supervisor_id,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.0000, 0.0000, 0.00, false, 'draft', $9, $10)
        RETURNING *;
      `;
      const runParams = [
        runData.run_number,
        runData.bom_id,
        runData.finished_good_item_id,
        runData.output_batch_number,
        runData.run_date,
        runData.planned_batch_count,
        runData.standard_batch_size,
        runData.planned_yield_qty,
        runData.supervisor_id,
        runData.notes || null,
      ];
      const runRes = await activeClient.query(runSql, runParams);
      const createdRun = runRes.rows[0];

      // Insert input lines
      for (const item of inputItems) {
        const inputSql = `
          INSERT INTO production_run_inputs (
            production_run_id,
            item_id,
            planned_qty,
            actual_issued_qty,
            actual_consumed_qty,
            good_production_qty,
            damaged_or_scrap_qty,
            returned_to_store_qty,
            uom_id,
            base_net_consumed_qty,
            unit_cost_applied,
            total_material_cost,
            consumption_variance_qty,
            consumption_variance_pct,
            is_consumption_flagged
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15);
        `;
        const inputParams = [
          createdRun.id,
          item.item_id,
          item.planned_qty,
          item.actual_issued_qty,
          item.actual_consumed_qty || null,
          item.good_production_qty || 0.0000,
          item.damaged_or_scrap_qty || 0.0000,
          item.returned_to_store_qty || 0.0000,
          item.uom_id,
          item.base_net_consumed_qty,
          item.unit_cost_applied || 0.0000,
          item.total_material_cost || 0.00,
          item.consumption_variance_qty || 0.0000,
          item.consumption_variance_pct || 0.00,
          item.is_consumption_flagged || false,
        ];
        await activeClient.query(inputSql, inputParams);
      }

      if (shouldManageClient) await activeClient.query('COMMIT');
      return createdRun;
    } catch (err) {
      if (shouldManageClient) await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageClient) activeClient.release();
    }
  },

  /**
   * Update production run inputs (only valid while in draft status)
   */
  async updateInputs(runId, inputItems, client = null) {
    const shouldManageClient = !client;
    const activeClient = client || (await getClient());

    try {
      if (shouldManageClient) await activeClient.query('BEGIN');

      for (const item of inputItems) {
        const updateSql = `
          UPDATE production_run_inputs
          SET actual_issued_qty = $1,
              good_production_qty = $2,
              damaged_or_scrap_qty = $3,
              returned_to_store_qty = $4,
              base_net_consumed_qty = $5
          WHERE production_run_id = $6 AND item_id = $7;
        `;
        await activeClient.query(updateSql, [
          item.actual_issued_qty,
          item.good_production_qty,
          item.damaged_or_scrap_qty,
          item.returned_to_store_qty,
          item.base_net_consumed_qty,
          runId,
          item.item_id,
        ]);
      }

      if (shouldManageClient) await activeClient.query('COMMIT');
    } catch (err) {
      if (shouldManageClient) await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageClient) activeClient.release();
    }
  },

  /**
   * Post production issue using database function fn_post_production_issue
   */
  async executePostIssue(runId, userId, client = null) {
    const runner = client || { query };
    await runner.query('SELECT fn_post_production_issue($1, $2);', [runId, userId]);
  },

  /**
   * Save overheads for a production run
   */
  async saveOverheads(runId, overheads, client = null) {
    const shouldManageClient = !client;
    const activeClient = client || (await getClient());

    try {
      if (shouldManageClient) await activeClient.query('BEGIN');

      await activeClient.query('DELETE FROM production_run_overheads WHERE production_run_id = $1;', [runId]);

      if (overheads && overheads.length > 0) {
        for (const ovh of overheads) {
          const insertSql = `
            INSERT INTO production_run_overheads (production_run_id, overhead_type, description, amount)
            VALUES ($1, $2, $3, $4);
          `;
          await activeClient.query(insertSql, [
            runId,
            ovh.overhead_type,
            ovh.description || null,
            ovh.amount,
          ]);
        }
      }

      if (shouldManageClient) await activeClient.query('COMMIT');
    } catch (err) {
      if (shouldManageClient) await activeClient.query('ROLLBACK');
      throw err;
    } finally {
      if (shouldManageClient) activeClient.release();
    }
  },

  /**
   * Update actual output and variance on header before posting yield
   */
  async updateOutputAndVariance(runId, updateData, client = null) {
    const runner = client || { query };
    const sql = `
      UPDATE production_runs
      SET actual_good_output_qty = $1,
          actual_scrap_output_qty = $2,
          yield_variance_pct = $3,
          is_yield_flagged = $4
      WHERE id = $5
      RETURNING *;
    `;
    const res = await runner.query(sql, [
      updateData.actual_good_output_qty,
      updateData.actual_scrap_output_qty || 0.0000,
      updateData.yield_variance_pct,
      updateData.is_yield_flagged,
      runId,
    ]);
    return res.rows[0];
  },

  /**
   * Post production yield using database function fn_post_production_yield
   */
  async executePostYield(runId, userId, client = null) {
    const runner = client || { query };
    await runner.query('SELECT fn_post_production_yield($1, $2);', [runId, userId]);
  },

  /**
   * Cancel draft production run
   */
  async cancelRun(runId, notes = null) {
    const sql = `
      UPDATE production_runs
      SET status = 'cancelled',
          notes = COALESCE($2, notes)
      WHERE id = $1
      RETURNING *;
    `;
    const res = await query(sql, [runId, notes]);
    return res.rows[0];
  },

  /**
   * Get production variance details from view v_production_variance
   */
  async getVariance(runId) {
    const sql = `
      SELECT *
      FROM v_production_variance
      WHERE production_run_id = $1
      ORDER BY material_type, material_name;
    `;
    const res = await query(sql, [runId]);
    return res.rows;
  },

  /**
   * Get costing details from production_run_costing
   */
  async getCosting(runId) {
    const sql = `
      SELECT *
      FROM production_run_costing
      WHERE production_run_id = $1;
    `;
    const res = await query(sql, [runId]);
    return res.rows[0] || null;
  },

  /**
   * Get overhead expenses for a production run
   */
  async getOverheads(runId) {
    const sql = `
      SELECT id, production_run_id, overhead_type, description, amount
      FROM production_run_overheads
      WHERE production_run_id = $1
      ORDER BY id ASC;
    `;
    const res = await query(sql, [runId]);
    return res.rows;
  },

  /**
   * Recalculate production run costing from material inputs, overheads, and output
   */
  async recalculateCosting(runId, client = null) {
    const runner = client || { query };
    const sql = `
      INSERT INTO production_run_costing (
        production_run_id,
        total_raw_material_cost,
        total_packaging_cost,
        total_direct_overhead_cost,
        gross_total_batch_cost,
        good_output_units,
        cost_per_packet,
        selling_price_per_packet,
        unit_gross_margin,
        gross_margin_pct,
        valuation_method_used,
        calculated_at
      )
      SELECT 
        pr.id,
        COALESCE(m.raw_cost, 0.00),
        COALESCE(m.pkg_cost, 0.00),
        COALESCE(o.ovh_cost, 0.00),
        ROUND(COALESCE(m.raw_cost, 0.00) + COALESCE(m.pkg_cost, 0.00) + COALESCE(o.ovh_cost, 0.00), 2),
        COALESCE(NULLIF(pr.actual_good_output_qty, 0), (pr.planned_batch_count * pr.standard_batch_size)),
        ROUND(
          (COALESCE(m.raw_cost, 0.00) + COALESCE(m.pkg_cost, 0.00) + COALESCE(o.ovh_cost, 0.00)) / 
          NULLIF(COALESCE(NULLIF(pr.actual_good_output_qty, 0), (pr.planned_batch_count * pr.standard_batch_size)), 0), 
          4
        ),
        fg.standard_selling_price,
        ROUND(
          fg.standard_selling_price - (
            (COALESCE(m.raw_cost, 0.00) + COALESCE(m.pkg_cost, 0.00) + COALESCE(o.ovh_cost, 0.00)) / 
            NULLIF(COALESCE(NULLIF(pr.actual_good_output_qty, 0), (pr.planned_batch_count * pr.standard_batch_size)), 0)
          ), 
          2
        ),
        ROUND(
          (
            (fg.standard_selling_price - (
              (COALESCE(m.raw_cost, 0.00) + COALESCE(m.pkg_cost, 0.00) + COALESCE(o.ovh_cost, 0.00)) / 
              NULLIF(COALESCE(NULLIF(pr.actual_good_output_qty, 0), (pr.planned_batch_count * pr.standard_batch_size)), 0)
            )) / NULLIF(fg.standard_selling_price, 0)
          ) * 100.0, 
          2
        ),
        'WEIGHTED_AVERAGE',
        NOW()
      FROM production_runs pr
      JOIN items fg ON pr.finished_good_item_id = fg.id
      LEFT JOIN (
        SELECT 
          production_run_id,
          COALESCE(SUM(CASE WHEN i.item_type = 'raw_material' THEN pri.total_material_cost ELSE 0 END), 0.00) AS raw_cost,
          COALESCE(SUM(CASE WHEN i.item_type = 'packaging' THEN pri.total_material_cost ELSE 0 END), 0.00) AS pkg_cost
        FROM production_run_inputs pri
        JOIN items i ON pri.item_id = i.id
        WHERE pri.production_run_id = $1
        GROUP BY production_run_id
      ) m ON pr.id = m.production_run_id
      LEFT JOIN (
        SELECT 
          production_run_id,
          COALESCE(SUM(amount), 0.00) AS ovh_cost
        FROM production_run_overheads
        WHERE production_run_id = $1
        GROUP BY production_run_id
      ) o ON pr.id = o.production_run_id
      WHERE pr.id = $1
      ON CONFLICT (production_run_id) DO UPDATE SET
        total_raw_material_cost = EXCLUDED.total_raw_material_cost,
        total_packaging_cost = EXCLUDED.total_packaging_cost,
        total_direct_overhead_cost = EXCLUDED.total_direct_overhead_cost,
        gross_total_batch_cost = EXCLUDED.gross_total_batch_cost,
        good_output_units = EXCLUDED.good_output_units,
        cost_per_packet = EXCLUDED.cost_per_packet,
        selling_price_per_packet = EXCLUDED.selling_price_per_packet,
        unit_gross_margin = EXCLUDED.unit_gross_margin,
        gross_margin_pct = EXCLUDED.gross_margin_pct,
        calculated_at = NOW()
      RETURNING *;
    `;
    const res = await runner.query(sql, [runId]);
    return res.rows[0] || null;
  },

  /**
   * Delete an overhead entry and recalculate costing
   */
  async deleteOverhead(runId, overheadId, client = null) {
    const runner = client || { query };
    await runner.query(
      'DELETE FROM production_run_overheads WHERE id = $1 AND production_run_id = $2;',
      [overheadId, runId]
    );
    return await this.recalculateCosting(runId, client);
  },

  /**
   * Get costing summary across all production runs
   */
  async getAllCostingSummary() {
    const sql = `
      SELECT 
        pr.id AS production_run_id,
        pr.run_number,
        pr.run_date,
        pr.status,
        fg.name AS finished_good_name,
        fg.sku AS finished_good_sku,
        pr.actual_good_output_qty,
        pr.planned_batch_count,
        pr.standard_batch_size,
        c.total_raw_material_cost,
        c.total_packaging_cost,
        c.total_direct_overhead_cost,
        c.gross_total_batch_cost,
        c.cost_per_packet,
        c.selling_price_per_packet,
        c.unit_gross_margin,
        c.gross_margin_pct,
        c.calculated_at,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', o.id, 
            'overhead_type', o.overhead_type, 
            'description', o.description, 
            'amount', o.amount
          )) FROM production_run_overheads o WHERE o.production_run_id = pr.id),
          '[]'::json
        ) AS overheads
      FROM production_runs pr
      JOIN items fg ON pr.finished_good_item_id = fg.id
      LEFT JOIN production_run_costing c ON pr.id = c.production_run_id
      ORDER BY pr.run_date DESC, pr.created_at DESC;
    `;
    const res = await query(sql);
    return res.rows;
  },
};
