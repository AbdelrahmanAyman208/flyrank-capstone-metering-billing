/**
 * Unit tests for the cost calculation service.
 * 
 * Verifies that the pinned pricing constants produce exact expected totals
 * for known token breakdowns — no rounding, no floats in the math path.
 */

const costService = require('../src/services/costService');
const pricing = require('../src/config/pricing');

describe('Cost Service', () => {
  describe('calculateEventCost', () => {
    test('API call cost is quantity × flat rate', () => {
      const event = { usage_type: 'api_call', quantity: 10, metadata: {} };
      const cost = costService.calculateEventCost(event);
      expect(cost).toBe(10 * pricing.API_CALL_RATE); // 10 × 500 = 5000 microdollars
    });

    test('AI token cost uses separate rates per token type', () => {
      const event = {
        usage_type: 'ai_tokens',
        quantity: 1000,
        metadata: {
          input_tokens: 500,
          cached_input_tokens: 200,
          output_tokens: 200,
          reasoning_tokens: 100,
        },
      };

      const cost = costService.calculateEventCost(event);

      // Expected: 500×250 + 200×125 + 200×1000 + 100×1000
      //         = 125000  + 25000   + 200000   + 100000
      //         = 450000 microdollars
      const expected =
        (500 * pricing.INPUT_TOKEN_RATE) +
        (200 * pricing.CACHED_INPUT_TOKEN_RATE) +
        (200 * pricing.OUTPUT_TOKEN_RATE) +
        (100 * pricing.REASONING_TOKEN_RATE);

      expect(cost).toBe(expected);
      expect(cost).toBe(450000);
    });

    test('cached input tokens are cheaper than fresh input', () => {
      const freshEvent = {
        usage_type: 'ai_tokens', quantity: 100,
        metadata: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 },
      };
      const cachedEvent = {
        usage_type: 'ai_tokens', quantity: 100,
        metadata: { input_tokens: 0, cached_input_tokens: 100, output_tokens: 0, reasoning_tokens: 0 },
      };

      const freshCost = costService.calculateEventCost(freshEvent);
      const cachedCost = costService.calculateEventCost(cachedEvent);

      expect(cachedCost).toBeLessThan(freshCost);
      expect(freshCost).toBe(100 * pricing.INPUT_TOKEN_RATE);     // 25000
      expect(cachedCost).toBe(100 * pricing.CACHED_INPUT_TOKEN_RATE); // 12500
    });

    test('reasoning tokens are billed at output rate', () => {
      const outputEvent = {
        usage_type: 'ai_tokens', quantity: 100,
        metadata: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 100, reasoning_tokens: 0 },
      };
      const reasoningEvent = {
        usage_type: 'ai_tokens', quantity: 100,
        metadata: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 100 },
      };

      expect(costService.calculateEventCost(outputEvent))
        .toBe(costService.calculateEventCost(reasoningEvent));
    });

    test('missing metadata fields default to 0', () => {
      const event = { usage_type: 'ai_tokens', quantity: 100, metadata: {} };
      expect(costService.calculateEventCost(event)).toBe(0);
    });

    test('applies overage multiplier to excess quantity', () => {
      const event = { 
        usage_type: 'api_call', 
        quantity: 10, 
        metadata: { is_overage: true, overage_quantity: 5 } 
      };
      // Base: 10 * 500 = 5000
      // Overage markup: (5 * 500) * (1.5 - 1) = 2500 * 0.5 = 1250
      // Total: 6250
      const cost = costService.calculateEventCost(event);
      expect(cost).toBe(6250);
    });
  });

  describe('calculateTotalCost', () => {
    test('aggregates multiple events correctly', () => {
      const events = [
        { usage_type: 'api_call', quantity: 5, metadata: {} },
        { usage_type: 'api_call', quantity: 3, metadata: {} },
        {
          usage_type: 'ai_tokens', quantity: 1000,
          metadata: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 200, reasoning_tokens: 100 },
        },
      ];

      const result = costService.calculateTotalCost(events);

      // API calls: (5+3) × 500 = 4000
      // AI tokens: 450000 (from earlier test)
      // Total: 454000 microdollars
      expect(result.apiCalls.costMicrodollars).toBe(8 * pricing.API_CALL_RATE);
      expect(result.aiTokens.costMicrodollars).toBe(450000);
      expect(result.total.costMicrodollars).toBe(4000 + 450000);
    });

    test('token breakdown is accumulated across events', () => {
      const events = [
        {
          usage_type: 'ai_tokens', quantity: 100,
          metadata: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 50, reasoning_tokens: 0 },
        },
        {
          usage_type: 'ai_tokens', quantity: 200,
          metadata: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 30, reasoning_tokens: 20 },
        },
      ];

      const result = costService.calculateTotalCost(events);

      expect(result.aiTokens.breakdown.inputTokens).toBe(150);
      expect(result.aiTokens.breakdown.cachedInputTokens).toBe(50);
      expect(result.aiTokens.breakdown.outputTokens).toBe(80);
      expect(result.aiTokens.breakdown.reasoningTokens).toBe(20);
    });
  });

  describe('microdollarsToDollars', () => {
    test('converts exact values', () => {
      expect(costService.microdollarsToDollars(1000000)).toBe('1.000000');
      expect(costService.microdollarsToDollars(0)).toBe('0.000000');
      expect(costService.microdollarsToDollars(500)).toBe('0.000500');
      expect(costService.microdollarsToDollars(454000)).toBe('0.454000');
    });

    test('handles large values', () => {
      // $100.50 = 100,500,000 microdollars
      expect(costService.microdollarsToDollars(100500000)).toBe('100.500000');
    });
  });
});
