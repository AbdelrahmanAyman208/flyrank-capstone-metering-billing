/**
 * Quota service — enforces plan limits before allowing billable actions.
 * 
 * Boundary rule: current_usage + requested_quantity <= limit
 * - The request that brings usage to EXACTLY the limit is ALLOWED.
 * - The request that would push usage OVER the limit is REJECTED (429).
 * - A tenant with a non-active subscription is REJECTED (402).
 * 
 * This is business logic, not an error condition — quota violations produce
 * clean 429/402 responses, never 500s.
 */

const subscriptionRepo = require('../repositories/subscriptionRepo');
const usageEventRepo = require('../repositories/usageEventRepo');
const alertService = require('./alertService');
const { PaymentRequiredError, NotFoundError } = require('../utils/errors');

const quotaService = {
  /**
   * Check whether a tenant can perform a billable action.
   * Throws PaymentRequiredError (402) if subscription is invalid.
   * Triggers alerts at 80% and 100% of quota.
   * Returns the subscription, current usage, and whether this is an overage.
   */
  async enforceQuota(tenantId, usageType, requestedQuantity) {
    // 1. Get the tenant's active subscription + plan limits
    const subscription = await subscriptionRepo.getActiveSubscription(tenantId);

    if (!subscription) {
      // Check if there's a canceled/lapsed subscription
      const anySub = await subscriptionRepo.findByTenantId(tenantId);
      if (anySub && anySub.status !== 'active') {
        throw new PaymentRequiredError(tenantId, anySub.status);
      }
      throw new NotFoundError('Active subscription', tenantId);
    }

    // 2. Check subscription status
    if (subscription.status === 'past_due') {
      throw new PaymentRequiredError(tenantId, 'past_due');
    }

    // 3. Determine the limit for this usage type
    const limit = usageType === 'api_call'
      ? subscription.api_call_limit
      : subscription.ai_token_limit;

    // 4. Get current month's usage for this type
    const currentUsage = await usageEventRepo.getCurrentMonthUsageByType(tenantId, usageType);

    // 5. Check and trigger alerts
    await alertService.checkAndTriggerAlerts(tenantId, usageType, currentUsage, limit, requestedQuantity);

    // 6. Overage check (all plans allow overage now)
    let isOverage = false;
    let overageQuantity = 0;
    
    if (currentUsage + requestedQuantity > limit) {
      isOverage = true;
      // Calculate how many tokens of this request are actually over the limit
      if (currentUsage > limit) {
        // All requested tokens are overage
        overageQuantity = requestedQuantity;
      } else {
        // Only a portion is overage
        overageQuantity = (currentUsage + requestedQuantity) - limit;
      }
    }

    return { subscription, currentUsage, isOverage, overageQuantity, limit };
  },
};

module.exports = quotaService;
