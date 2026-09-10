/**
 * Metering service — records billable usage events with idempotency.
 * 
 * This is the write path for usage data. The idempotency guarantee is
 * structural (database UNIQUE constraint on idempotency_key), not logical.
 * See usageEventRepo.insertEvent() for the implementation.
 */

const usageEventRepo = require('../repositories/usageEventRepo');

const meteringService = {
  /**
   * Record a usage event.
   * 
   * @param {Object} params
   * @param {string} params.tenantId - The tenant generating usage
   * @param {string} params.usageType - 'api_call' or 'ai_tokens'
   * @param {number} params.quantity - Integer amount of usage
   * @param {string} params.idempotencyKey - Client-provided dedup key
   * @param {Object} [params.metadata] - Optional: token breakdown for ai_tokens
   * 
   * @returns {{ event: Object, wasNew: boolean }}
   *   wasNew=true: first time seeing this key, event was created
   *   wasNew=false: duplicate key, returning the original event unchanged
   */
  async recordEvent({ tenantId, usageType, quantity, idempotencyKey, metadata }) {
    const result = await usageEventRepo.insertEvent({
      tenantId,
      usageType,
      quantity,
      idempotencyKey,
      metadata,
    });

    if (result.wasNew) {
      console.log(
        `[Metering] New event recorded: tenant=${tenantId} type=${usageType} qty=${quantity} key=${idempotencyKey}`
      );
    } else {
      console.log(
        `[Metering] Duplicate key, returning original: key=${idempotencyKey}`
      );
    }

    return result;
  },
};

module.exports = meteringService;
