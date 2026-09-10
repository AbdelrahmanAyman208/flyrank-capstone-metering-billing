/**
 * Pinned pricing constants — ALL values in MICRO-DOLLARS (1 micro-dollar = $0.000001).
 * 
 * Using micro-dollars (integer math) avoids floating-point rounding errors in billing.
 * Every rate here is an integer. To convert to dollars: value / 1_000_000.
 * 
 * These rates are loosely inspired by real-world LLM API pricing but are
 * illustrative — this is a metering/billing engine, not an AI API.
 */

module.exports = {
  // ----- AI Token Rates (micro-dollars per token) -----

  // Fresh input tokens — standard price for each token the model reads for the first time.
  // Real-world analogy: OpenAI charges ~$2.50 per 1M input tokens for GPT-4o.
  INPUT_TOKEN_RATE: 250,           // $0.000250 per token

  // Cached input tokens — discounted because the model reuses a previously-processed
  // context window, saving compute. Typically 50% of fresh input price.
  CACHED_INPUT_TOKEN_RATE: 125,    // $0.000125 per token

  // Output tokens — generation (writing) is more compute-intensive than reading.
  // Real-world analogy: OpenAI charges ~$10.00 per 1M output tokens for GPT-4o.
  OUTPUT_TOKEN_RATE: 1000,         // $0.001000 per token

  // Reasoning tokens — the model's internal "thinking" steps (e.g. chain-of-thought).
  // Billed at the output rate because reasoning is generation work, same compute cost.
  REASONING_TOKEN_RATE: 1000,      // $0.001000 per token

  // ----- API Call Rate (micro-dollars per call) -----

  // Flat per-call fee charged on every billable API invocation, regardless of tokens.
  // Covers infrastructure overhead (routing, auth, logging) beyond the model cost.
  API_CALL_RATE: 500,              // $0.000500 per call

  // ----- Overage Multiplier -----
  OVERAGE_MULTIPLIER: 1.5,         // Overage usage costs 50% more
};
