/**
 * Unit tests for the quota enforcement service.
 *
 * Tests the scary edge cases:
 * - Exactly at the limit (boundary)
 * - Just over the limit (overage detection)
 * - Already fully over the limit
 * - Inactive/past_due subscriptions → 402
 * - Missing subscription → 404
 * - Alert triggering at 80% and 100%
 */

// ── Mock all repository and service dependencies ─────────────────────
jest.mock('../src/repositories/subscriptionRepo');
jest.mock('../src/repositories/usageEventRepo');
jest.mock('../src/services/alertService');

const subscriptionRepo = require('../src/repositories/subscriptionRepo');
const usageEventRepo = require('../src/repositories/usageEventRepo');
const alertService = require('../src/services/alertService');
const quotaService = require('../src/services/quotaService');
const { PaymentRequiredError, NotFoundError } = require('../src/utils/errors');

// Suppress console.log in tests
beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(); });
afterAll(() => { console.log.mockRestore(); });

afterEach(() => jest.clearAllMocks());

// ── Helpers ──────────────────────────────────────────────────────────
function mockSubscription(overrides = {}) {
  return {
    id: 'sub-1',
    tenant_id: 'tenant-1',
    plan_name: 'free',
    status: 'active',
    api_call_limit: 1000,
    ai_token_limit: 100000,
    ...overrides,
  };
}

describe('QuotaService', () => {
  // ── Happy paths ─────────────────────────────────────────────────
  describe('enforceQuota — within limits', () => {
    test('allows request well under the limit', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(mockSubscription());
      usageEventRepo.getCurrentMonthUsageByType.mockResolvedValue(100);
      alertService.checkAndTriggerAlerts.mockResolvedValue();

      const result = await quotaService.enforceQuota('tenant-1', 'api_call', 10);

      expect(result.isOverage).toBe(false);
      expect(result.overageQuantity).toBe(0);
      expect(result.currentUsage).toBe(100);
      expect(result.limit).toBe(1000);
    });

    test('allows request that brings usage to exactly the limit', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(mockSubscription());
      usageEventRepo.getCurrentMonthUsageByType.mockResolvedValue(990);
      alertService.checkAndTriggerAlerts.mockResolvedValue();

      const result = await quotaService.enforceQuota('tenant-1', 'api_call', 10);

      // 990 + 10 = 1000 (exactly the limit) → NOT overage
      expect(result.isOverage).toBe(false);
      expect(result.overageQuantity).toBe(0);
    });
  });

  // ── Overage detection ───────────────────────────────────────────
  describe('enforceQuota — overage', () => {
    test('flags overage when request exceeds the limit', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(mockSubscription());
      usageEventRepo.getCurrentMonthUsageByType.mockResolvedValue(990);
      alertService.checkAndTriggerAlerts.mockResolvedValue();

      const result = await quotaService.enforceQuota('tenant-1', 'api_call', 20);

      // 990 + 20 = 1010 → 10 over the limit
      expect(result.isOverage).toBe(true);
      expect(result.overageQuantity).toBe(10);
    });

    test('calculates correct overage when already over the limit', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(mockSubscription());
      usageEventRepo.getCurrentMonthUsageByType.mockResolvedValue(1100);
      alertService.checkAndTriggerAlerts.mockResolvedValue();

      const result = await quotaService.enforceQuota('tenant-1', 'api_call', 50);

      // Already at 1100 (over 1000 limit) → entire 50 is overage
      expect(result.isOverage).toBe(true);
      expect(result.overageQuantity).toBe(50);
    });

    test('works for ai_tokens type', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(mockSubscription());
      usageEventRepo.getCurrentMonthUsageByType.mockResolvedValue(99000);
      alertService.checkAndTriggerAlerts.mockResolvedValue();

      const result = await quotaService.enforceQuota('tenant-1', 'ai_tokens', 2000);

      // 99000 + 2000 = 101000 → 1000 over 100000
      expect(result.isOverage).toBe(true);
      expect(result.overageQuantity).toBe(1000);
      expect(result.limit).toBe(100000);
    });
  });

  // ── Subscription errors ─────────────────────────────────────────
  describe('enforceQuota — subscription errors', () => {
    test('throws PaymentRequiredError for past_due subscription', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(
        mockSubscription({ status: 'past_due' })
      );

      await expect(
        quotaService.enforceQuota('tenant-1', 'api_call', 1)
      ).rejects.toThrow(PaymentRequiredError);
    });

    test('throws PaymentRequiredError when subscription is canceled', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(null);
      subscriptionRepo.findByTenantId.mockResolvedValue({ status: 'canceled' });

      await expect(
        quotaService.enforceQuota('tenant-1', 'api_call', 1)
      ).rejects.toThrow(PaymentRequiredError);
    });

    test('throws NotFoundError when no subscription exists at all', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(null);
      subscriptionRepo.findByTenantId.mockResolvedValue(null);

      await expect(
        quotaService.enforceQuota('tenant-1', 'api_call', 1)
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ── Alert delegation ────────────────────────────────────────────
  describe('enforceQuota — alert triggering', () => {
    test('calls alertService.checkAndTriggerAlerts with correct arguments', async () => {
      subscriptionRepo.getActiveSubscription.mockResolvedValue(mockSubscription());
      usageEventRepo.getCurrentMonthUsageByType.mockResolvedValue(750);
      alertService.checkAndTriggerAlerts.mockResolvedValue();

      await quotaService.enforceQuota('tenant-1', 'api_call', 100);

      expect(alertService.checkAndTriggerAlerts).toHaveBeenCalledWith(
        'tenant-1', 'api_call', 750, 1000, 100
      );
    });
  });
});
