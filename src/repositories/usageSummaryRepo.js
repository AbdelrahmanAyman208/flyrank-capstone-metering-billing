/**
 * Usage summary repository — data access for usage_summaries table.
 * Used by the background rollup job to store pre-aggregated monthly data.
 */

const pool = require('../config/db');

const usageSummaryRepo = {
  async upsert({ tenantId, month, apiCallsTotal, aiTokensTotal, costMicrodollars }) {
    const { rows } = await pool.query(
      `INSERT INTO usage_summaries (tenant_id, month, api_calls_total, ai_tokens_total, cost_microdollars)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, month)
       DO UPDATE SET
         api_calls_total = $3,
         ai_tokens_total = $4,
         cost_microdollars = $5,
         updated_at = NOW()
       RETURNING *`,
      [tenantId, month, apiCallsTotal, aiTokensTotal, costMicrodollars]
    );
    return rows[0];
  },

  async findByTenantAndMonth(tenantId, month) {
    const { rows } = await pool.query(
      `SELECT * FROM usage_summaries
       WHERE tenant_id = $1 AND month = $2`,
      [tenantId, month]
    );
    return rows[0] || null;
  },
};

module.exports = usageSummaryRepo;
