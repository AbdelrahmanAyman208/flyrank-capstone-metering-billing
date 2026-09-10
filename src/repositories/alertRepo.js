const { Pool } = require('pg');
const pool = require('../config/db');

const alertRepo = {
  /**
   * Attempt to insert an alert. Returns true if inserted, false if it already exists (due to UNIQUE constraint).
   */
  async insertAlert(tenantId, usageType, thresholdPct) {
    try {
      const result = await pool.query(
        `INSERT INTO usage_alerts (tenant_id, month, usage_type, threshold_pct)
         VALUES ($1, date_trunc('month', NOW()), $2, $3)
         ON CONFLICT (tenant_id, month, usage_type, threshold_pct) DO NOTHING
         RETURNING id`,
        [tenantId, usageType, thresholdPct]
      );
      return result.rowCount > 0;
    } catch (err) {
      console.error('[AlertRepo] Error inserting alert:', err.message);
      return false;
    }
  },

  /**
   * Get all alerts for a tenant for the current month, ordered by newest first.
   */
  async getRecentAlerts(tenantId) {
    const result = await pool.query(
      `SELECT id, usage_type, threshold_pct, created_at
       FROM usage_alerts
       WHERE tenant_id = $1 AND month = date_trunc('month', NOW())
       ORDER BY created_at DESC
       LIMIT 50`,
      [tenantId]
    );
    return result.rows;
  }
};

module.exports = alertRepo;
