/**
 * GET /usage — current-month usage rollup for a tenant.
 * 
 * Returns: plan info, API call usage, AI token usage, cost breakdown, recent events.
 * All cost values are computed from pinned pricing constants.
 */

const express = require('express');
const router = express.Router();
const { validate } = require('../middleware/validateInput');
const tenantRepo = require('../repositories/tenantRepo');
const subscriptionRepo = require('../repositories/subscriptionRepo');
const usageEventRepo = require('../repositories/usageEventRepo');
const costService = require('../services/costService');
const { NotFoundError } = require('../utils/errors');

const usageValidation = validate({
  tenantId: { type: 'string', required: true },
}, 'query');

router.get('/', usageValidation, async (req, res, next) => {
  try {
    const { tenantId } = req.query;

    // Verify tenant exists
    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant', tenantId);
    }

    // Get current subscription + plan limits
    const subscription = await subscriptionRepo.findByTenantId(tenantId);
    if (!subscription) {
      throw new NotFoundError('Subscription', tenantId);
    }

    // Get current month's usage totals
    const usage = await usageEventRepo.getCurrentMonthUsage(tenantId);

    // Get all events for cost calculation
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const events = await usageEventRepo.getEventsForMonth(tenantId, monthStart.toISOString());

    // Calculate costs
    const costBreakdown = costService.calculateTotalCost(events);

    // Get recent events for display
    const recentEvents = await usageEventRepo.getRecentEvents(tenantId, 10);

    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
      },
      plan: {
        name: subscription.plan_name,
        displayName: subscription.plan_display_name,
        status: subscription.status,
      },
      apiCalls: {
        used: usage.api_call,
        limit: subscription.api_call_limit,
        percentage: subscription.api_call_limit > 0
          ? Math.round((usage.api_call / subscription.api_call_limit) * 100)
          : 0,
      },
      aiTokens: {
        used: usage.ai_tokens,
        limit: subscription.ai_token_limit,
        percentage: subscription.ai_token_limit > 0
          ? Math.round((usage.ai_tokens / subscription.ai_token_limit) * 100)
          : 0,
      },
      cost: costBreakdown,
      recentEvents: recentEvents.map(e => ({
        id: e.id,
        usageType: e.usage_type,
        quantity: e.quantity,
        metadata: e.metadata,
        createdAt: e.created_at,
      })),
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
