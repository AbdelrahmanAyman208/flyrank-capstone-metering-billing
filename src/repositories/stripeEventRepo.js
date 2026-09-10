/**
 * Stripe events repository — webhook deduplication.
 * 
 * Before processing any webhook, we check if the Stripe event ID
 * has already been recorded. If it has, we skip processing.
 */

const pool = require('../config/db');

const stripeEventRepo = {
  /**
   * Returns true if the event was newly inserted (should be processed),
   * false if it already existed (should be skipped).
   */
  async markProcessed(eventId, eventType) {
    const result = await pool.query(
      `INSERT INTO stripe_events (event_id, event_type)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      [eventId, eventType]
    );
    return result.rows.length > 0;  // true = new, false = duplicate
  },
};

module.exports = stripeEventRepo;
