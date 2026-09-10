/**
 * POST /generate — the dummy billable endpoint.
 * 
 * Takes an idempotency key + usage amount, checks quota, records the event.
 * Returns the result or a 429/402.
 * 
 * This is the core money-correctness flow:
 * 1. Validate input
 * 2. Check quota (before recording — fail fast)
 * 3. Record usage event (idempotent via DB unique constraint)
 * 4. Return result
 * 
 * For ai_tokens usage type, the caller passes a token breakdown in metadata:
 * { inputTokens, cachedInputTokens, outputTokens, reasoningTokens }
 * The total quantity should equal the sum of all token types.
 */

const express = require('express');
const router = express.Router();
const { validate } = require('../middleware/validateInput');
const quotaService = require('../services/quotaService');
const meteringService = require('../services/meteringService');
const tenantRepo = require('../repositories/tenantRepo');
const { NotFoundError, ValidationError } = require('../utils/errors');

const generateValidation = validate({
  tenantId: { type: 'string', required: true },
  idempotencyKey: { type: 'string', required: true },
  usageType: { type: 'string', required: true, enum: ['api_call', 'ai_tokens'] },
  quantity: { type: 'integer', required: true },
}, 'body');

router.post('/', generateValidation, async (req, res, next) => {
  try {
    const { tenantId, idempotencyKey, usageType, quantity, metadata } = req.body;
    const qty = Number(quantity);

    // Verify tenant exists
    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant', tenantId);
    }

    // Validate token metadata for ai_tokens events
    let eventMetadata = metadata || {};
    if (usageType === 'ai_tokens') {
      const inputTokens = eventMetadata.inputTokens || eventMetadata.input_tokens || 0;
      const cachedInputTokens = eventMetadata.cachedInputTokens || eventMetadata.cached_input_tokens || 0;
      const outputTokens = eventMetadata.outputTokens || eventMetadata.output_tokens || 0;
      const reasoningTokens = eventMetadata.reasoningTokens || eventMetadata.reasoning_tokens || 0;

      // Normalize metadata keys to snake_case for consistent storage
      eventMetadata = {
        input_tokens: inputTokens,
        cached_input_tokens: cachedInputTokens,
        output_tokens: outputTokens,
        reasoning_tokens: reasoningTokens,
      };
    }

    // 1. Enforce quota — throws 402 if invalid. Triggers alerts and calculates overage.
    const { subscription, currentUsage, isOverage, overageQuantity } = await quotaService.enforceQuota(tenantId, usageType, qty);

    // Add overage info to metadata so cost calculation knows how to price it
    if (isOverage) {
      eventMetadata.is_overage = true;
      eventMetadata.overage_quantity = overageQuantity;
    }

    // 2. Record usage event (idempotent)
    const { event, wasNew } = await meteringService.recordEvent({
      tenantId,
      usageType,
      quantity: qty,
      idempotencyKey,
      metadata: eventMetadata,
    });

    // 3. Return result
    res.status(200).json({
      success: true,
      event: {
        id: event.id,
        tenantId: event.tenant_id,
        usageType: event.usage_type,
        quantity: event.quantity,
        idempotencyKey: event.idempotency_key,
        metadata: event.metadata,
        createdAt: event.created_at,
      },
      wasNew,
      usage: {
        currentUsage: wasNew ? currentUsage + qty : currentUsage,
        limit: usageType === 'api_call' ? subscription.api_call_limit : subscription.ai_token_limit,
        plan: subscription.plan_name,
      },
      // Simulated AI response (this is a dummy endpoint — no real model call)
      generatedContent: wasNew
        ? `Simulated response for ${usageType} event (${qty} units consumed)`
        : `Duplicate request — returning original response`,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
