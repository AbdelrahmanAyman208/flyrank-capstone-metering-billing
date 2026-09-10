/**
 * Usage event repository — data access for usage_events table.
 * 
 * This is where structural idempotency lives:
 * insertEvent() uses INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
 * to guarantee that two concurrent inserts with the same key produce exactly one row.
 * The database's UNIQUE constraint is the enforcement mechanism, not application code.
 */

const pool = require('../config/db');

const usageEventRepo = {
  /**
   * Insert a usage event with idempotency guarantee.
   * 
   * Strategy:
   * 1. Try INSERT with ON CONFLICT DO NOTHING
   * 2. If insert succeeded (rowCount = 1), return the new row + wasNew: true
   * 3. If insert was a no-op (duplicate key), SELECT the existing row + wasNew: false
   * 
   * This works correctly under concurrent requests because the UNIQUE constraint
   * on idempotency_key is enforced by PostgreSQL at the transaction isolation level.
   */
  async insertEvent({ tenantId, usageType, quantity, idempotencyKey, metadata }) {
    // Attempt the insert — ON CONFLICT DO NOTHING means no error on duplicate
    const insertResult = await pool.query(
      `INSERT INTO usage_events (tenant_id, usage_type, quantity, idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [tenantId, usageType, quantity, idempotencyKey, JSON.stringify(metadata || {})]
    );

    if (insertResult.rows.length > 0) {
      // Insert succeeded — this is a new event
      return { event: insertResult.rows[0], wasNew: true };
    }

    // Insert was a no-op — the idempotency key already exists. Fetch the original.
    const { rows } = await pool.query(
      'SELECT * FROM usage_events WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    return { event: rows[0], wasNew: false };
  },

  /**
   * Sum usage for a tenant in the current calendar month, grouped by type.
   * Used for quota enforcement and the /usage rollup endpoint.
   */
  async getCurrentMonthUsage(tenantId) {
    const { rows } = await pool.query(
      `SELECT usage_type, COALESCE(SUM(quantity), 0)::INTEGER AS total
       FROM usage_events
       WHERE tenant_id = $1
         AND created_at >= date_trunc('month', NOW())
         AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
       GROUP BY usage_type`,
      [tenantId]
    );

    // Convert to a map: { api_call: N, ai_tokens: M }
    const usage = { api_call: 0, ai_tokens: 0 };
    for (const row of rows) {
      usage[row.usage_type] = row.total;
    }
    return usage;
  },

  /**
   * Sum usage for a specific type (used by quota check to avoid loading everything).
   */
  async getCurrentMonthUsageByType(tenantId, usageType) {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0)::INTEGER AS total
       FROM usage_events
       WHERE tenant_id = $1
         AND usage_type = $2
         AND created_at >= date_trunc('month', NOW())
         AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'`,
      [tenantId, usageType]
    );
    return rows[0].total;
  },

  /**
   * Get recent events for a tenant (for the /usage endpoint's recentEvents field).
   */
  async getRecentEvents(tenantId, limit = 10) {
    const { rows } = await pool.query(
      `SELECT * FROM usage_events
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return rows;
  },

  /**
   * Get all events for a tenant in a specific month (for cost calculation).
   */
  async getEventsForMonth(tenantId, monthStart) {
    const { rows } = await pool.query(
      `SELECT * FROM usage_events
       WHERE tenant_id = $1
         AND created_at >= $2
         AND created_at < $2::TIMESTAMPTZ + INTERVAL '1 month'
       ORDER BY created_at`,
      [tenantId, monthStart]
    );
    return rows;
  },
};

module.exports = usageEventRepo;
