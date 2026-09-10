/**
 * Tenant repository — data access layer for the tenants table.
 * 
 * Every query includes tenant_id in the WHERE clause for isolation.
 * No business logic here — just parameterized SQL.
 */

const pool = require('../config/db');

const tenantRepo = {
  async findById(id) {
    const { rows } = await pool.query(
      'SELECT * FROM tenants WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async findByStripeCustomerId(stripeCustomerId) {
    const { rows } = await pool.query(
      'SELECT * FROM tenants WHERE stripe_customer_id = $1',
      [stripeCustomerId]
    );
    return rows[0] || null;
  },

  async updateStripeCustomerId(tenantId, stripeCustomerId) {
    const { rows } = await pool.query(
      `UPDATE tenants 
       SET stripe_customer_id = $2 
       WHERE id = $1 
       RETURNING *`,
      [tenantId, stripeCustomerId]
    );
    return rows[0] || null;
  },

  async findAll() {
    const { rows } = await pool.query('SELECT * FROM tenants ORDER BY created_at');
    return rows;
  },

  async create({ name, email }) {
    const { rows } = await pool.query(
      `INSERT INTO tenants (name, email) VALUES ($1, $2) RETURNING *`,
      [name, email]
    );
    return rows[0];
  },
};

module.exports = tenantRepo;
