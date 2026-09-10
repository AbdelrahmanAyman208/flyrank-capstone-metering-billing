/**
 * Plan repository — data access for the plans table.
 */

const pool = require('../config/db');

const planRepo = {
  async findByName(name) {
    const { rows } = await pool.query(
      'SELECT * FROM plans WHERE name = $1',
      [name]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await pool.query(
      'SELECT * FROM plans WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async findAll() {
    const { rows } = await pool.query('SELECT * FROM plans ORDER BY price_cents');
    return rows;
  },
};

module.exports = planRepo;
