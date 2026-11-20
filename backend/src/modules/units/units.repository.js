import { query } from '../../config/db.js';

export const unitsRepository = {
  /**
   * Retrieve all units of measure ordered by dimension and ID
   * @returns {Promise<Array>}
   */
  async findAll() {
    const text = `
      SELECT id, name, dimension, base_unit_id, conversion_factor_to_base
      FROM units_of_measure
      ORDER BY dimension, id;
    `;
    const res = await query(text);
    return res.rows;
  },

  /**
   * Find a unit of measure by its primary key ID (e.g. 'KG', 'PCS')
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    const text = `
      SELECT id, name, dimension, base_unit_id, conversion_factor_to_base
      FROM units_of_measure
      WHERE id = $1;
    `;
    const res = await query(text, [id]);
    return res.rows[0] || null;
  },

  /**
   * Create a new unit of measure
   * @param {object} unitData
   * @returns {Promise<object>}
   */
  async create(unitData) {
    const { id, name, dimension, base_unit_id, conversion_factor_to_base } = unitData;
    const text = `
      INSERT INTO units_of_measure (id, name, dimension, base_unit_id, conversion_factor_to_base)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, dimension, base_unit_id, conversion_factor_to_base;
    `;
    const res = await query(text, [
      id,
      name,
      dimension,
      base_unit_id || null,
      conversion_factor_to_base || 1.0,
    ]);
    return res.rows[0];
  },

  /**
   * Execute the database function fn_compute_base_quantity to convert transaction UOM to item base UOM
   * @param {string} itemId - UUID
   * @param {number} quantity
   * @param {string} uomId
   * @returns {Promise<number>}
   */
  async computeBaseQuantity(itemId, quantity, uomId) {
    const text = `SELECT fn_compute_base_quantity($1, $2, $3) AS base_quantity;`;
    const res = await query(text, [itemId, quantity, uomId]);
    return parseFloat(res.rows[0].base_quantity);
  },
};
