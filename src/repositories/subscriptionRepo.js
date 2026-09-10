/**
 * Subscription repository — data access for the subscriptions table.
 * 
 * Key query: getActiveSubscription joins subscriptions→plans
 * to return the tenant's current plan limits in one query.
 */

const pool = require('../config/db');

const subscriptionRepo = {
  /**
   * Returns the tenant's active (or past_due) subscription with plan details.
   * This is the primary query used by quota enforcement.
   */
  async getActiveSubscription(tenantId) {
    const { rows } = await pool.query(
      `SELECT s.*, p.name AS plan_name, p.display_name AS plan_display_name,
              p.api_call_limit, p.ai_token_limit, p.price_cents
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = $1
         AND s.status IN ('active', 'past_due')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [tenantId]
    );
    return rows[0] || null;
  },

  async findByTenantId(tenantId) {
    const { rows } = await pool.query(
      `SELECT s.*, p.name AS plan_name, p.display_name AS plan_display_name,
              p.api_call_limit, p.ai_token_limit, p.price_cents
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [tenantId]
    );
    return rows[0] || null;
  },

  async findByStripeSubscriptionId(stripeSubscriptionId) {
    const { rows } = await pool.query(
      `SELECT s.*, p.name AS plan_name
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.stripe_subscription_id = $1`,
      [stripeSubscriptionId]
    );
    return rows[0] || null;
  },

  async findAllActiveWithStripeId() {
    const { rows } = await pool.query(
      `SELECT s.*
       FROM subscriptions s
       WHERE s.status IN ('active', 'past_due') 
         AND s.stripe_subscription_id IS NOT NULL`
    );
    return rows;
  },

  async create({ tenantId, planId, status, stripeSubscriptionId }) {
    const { rows } = await pool.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, stripe_subscription_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, planId, status || 'active', stripeSubscriptionId || null]
    );
    return rows[0];
  },

  /**
   * Upgrade a tenant's subscription: cancel old, create new.
   * Done in a transaction to prevent inconsistent state.
   */
  async upgradePlan(tenantId, newPlanId, stripeSubscriptionId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Cancel any existing active subscription
      await client.query(
        `UPDATE subscriptions 
         SET status = 'canceled', updated_at = NOW()
         WHERE tenant_id = $1 AND status IN ('active', 'past_due')`,
        [tenantId]
      );

      // Create new subscription
      const { rows } = await client.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, stripe_subscription_id)
         VALUES ($1, $2, 'active', $3)
         RETURNING *`,
        [tenantId, newPlanId, stripeSubscriptionId]
      );

      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateStatus(stripeSubscriptionId, status) {
    const { rows } = await pool.query(
      `UPDATE subscriptions 
       SET status = $2, updated_at = NOW()
       WHERE stripe_subscription_id = $1
       RETURNING *`,
      [stripeSubscriptionId, status]
    );
    return rows[0] || null;
  },
};

module.exports = subscriptionRepo;
