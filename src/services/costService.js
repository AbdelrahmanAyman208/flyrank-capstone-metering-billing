/**
 * Cost service — calculates costs from usage events using pinned pricing.
 * 
 * ALL arithmetic is integer math in micro-dollars (1 micro-dollar = $0.000001).
 * No floats anywhere. Final display conversion to dollars happens only at the
 * response-formatting layer, never in calculation.
 * 
 * Token pricing rules:
 * - Input tokens, cached input tokens, output tokens, and reasoning tokens
 *   are priced SEPARATELY and cannot simply be summed.
 * - Cached input is cheaper than fresh input (model reuses prior context).
 * - Reasoning tokens are billed at the output rate (generation work).
 */

const pricing = require('../config/pricing');

const costService = {
  /**
   * Calculate cost for a single usage event.
   * Returns cost in micro-dollars (integer).
   */
  calculateEventCost(event) {
    const meta = event.metadata || {};
    const isOverage = meta.is_overage || false;
    const overageQty = meta.overage_quantity || 0;

    if (event.usage_type === 'api_call') {
      let baseCost = event.quantity * pricing.API_CALL_RATE;
      if (isOverage) {
        // Subtract the base cost of the overage portion, add the multiplied cost
        baseCost += Math.floor((overageQty * pricing.API_CALL_RATE) * (pricing.OVERAGE_MULTIPLIER - 1));
      }
      return baseCost;
    }

    if (event.usage_type === 'ai_tokens') {
      const inputTokens = meta.input_tokens || 0;
      const cachedInputTokens = meta.cached_input_tokens || 0;
      const outputTokens = meta.output_tokens || 0;
      const reasoningTokens = meta.reasoning_tokens || 0;

      let baseCost =
        (inputTokens * pricing.INPUT_TOKEN_RATE) +
        (cachedInputTokens * pricing.CACHED_INPUT_TOKEN_RATE) +
        (outputTokens * pricing.OUTPUT_TOKEN_RATE) +
        (reasoningTokens * pricing.REASONING_TOKEN_RATE);

      if (isOverage && event.quantity > 0) {
        // Distribute the overage multiplier proportionally across the total cost
        const overageMarkup = Math.floor((baseCost * overageQty * (pricing.OVERAGE_MULTIPLIER - 1)) / event.quantity);
        baseCost += overageMarkup;
      }

      return baseCost;
    }

    return 0;
  },

  /**
   * Calculate costs for a list of events.
   * Returns a breakdown by type and a total, all in micro-dollars.
   */
  calculateTotalCost(events) {
    let apiCallCost = 0;
    let aiTokenCost = 0;

    // Detailed token breakdown for transparency
    let tokenBreakdown = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    };

    for (const event of events) {
      const eventCost = costService.calculateEventCost(event);

      if (event.usage_type === 'api_call') {
        apiCallCost += eventCost;
      } else if (event.usage_type === 'ai_tokens') {
        aiTokenCost += eventCost;
        const meta = event.metadata || {};
        tokenBreakdown.inputTokens += (meta.input_tokens || 0);
        tokenBreakdown.cachedInputTokens += (meta.cached_input_tokens || 0);
        tokenBreakdown.outputTokens += (meta.output_tokens || 0);
        tokenBreakdown.reasoningTokens += (meta.reasoning_tokens || 0);
      }
    }

    const totalMicrodollars = apiCallCost + aiTokenCost;

    return {
      apiCalls: {
        costMicrodollars: apiCallCost,
        costDollars: costService.microdollarsToDollars(apiCallCost),
      },
      aiTokens: {
        costMicrodollars: aiTokenCost,
        costDollars: costService.microdollarsToDollars(aiTokenCost),
        breakdown: tokenBreakdown,
      },
      total: {
        costMicrodollars: totalMicrodollars,
        costDollars: costService.microdollarsToDollars(totalMicrodollars),
      },
    };
  },

  /**
   * Convert micro-dollars to a display-friendly dollar string.
   * This is the ONLY place floats appear — and only for display, never for math.
   * We convert integer micro-dollars → string with exactly 6 decimal places.
   */
  microdollarsToDollars(microdollars) {
    // Integer division to get dollars and remainder
    const dollars = Math.floor(microdollars / 1_000_000);
    const remainder = microdollars % 1_000_000;
    return `${dollars}.${remainder.toString().padStart(6, '0')}`;
  },
};

module.exports = costService;
