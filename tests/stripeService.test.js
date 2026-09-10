/**
 * Unit tests for the Stripe service.
 *
 * Tests webhook deduplication, event routing,
 * checkout flow, and reconciliation logic.
 */

jest.mock('../src/config/stripe', () => ({
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn() },
}));
jest.mock('../src/repositories/tenantRepo');
jest.mock('../src/repositories/planRepo');
jest.mock('../src/repositories/subscriptionRepo');
jest.mock('../src/repositories/stripeEventRepo');

const stripe = require('../src/config/stripe');
const tenantRepo = require('../src/repositories/tenantRepo');
const planRepo = require('../src/repositories/planRepo');
const subscriptionRepo = require('../src/repositories/subscriptionRepo');
const stripeEventRepo = require('../src/repositories/stripeEventRepo');
const stripeService = require('../src/services/stripeService');

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(); jest.spyOn(console, 'error').mockImplementation(); });
afterAll(() => { console.log.mockRestore(); console.error.mockRestore(); });
afterEach(() => jest.clearAllMocks());

describe('StripeService', () => {
  // ── Webhook deduplication ───────────────────────────────────────
  describe('handleWebhookEvent — deduplication', () => {
    test('skips duplicate events', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(false); // Already seen

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_duplicate',
        type: 'checkout.session.completed',
        data: { object: {} },
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('duplicate_event');
    });

    test('processes new events', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true); // New event
      planRepo.findByName.mockResolvedValue({ id: 'plan-pro' });
      subscriptionRepo.upgradePlan.mockResolvedValue({ id: 'sub-new' });

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_new',
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { tenantId: 'tenant-1' },
            subscription: 'sub_stripe_123',
          },
        },
      });

      expect(result.action).toBe('upgraded_to_pro');
      expect(subscriptionRepo.upgradePlan).toHaveBeenCalledWith(
        'tenant-1', 'plan-pro', 'sub_stripe_123'
      );
    });
  });

  // ── Unhandled event types ───────────────────────────────────────
  describe('handleWebhookEvent — unhandled types', () => {
    test('skips unhandled event types gracefully', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_123',
        type: 'invoice.payment_succeeded',
        data: { object: {} },
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('unhandled_event_type');
    });
  });

  // ── checkout.session.completed ──────────────────────────────────
  describe('handleWebhookEvent — checkout.session.completed', () => {
    test('returns error if tenantId is missing from metadata', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_no_tenant',
        type: 'checkout.session.completed',
        data: { object: { metadata: {} } },
      });

      expect(result.error).toBe('missing_tenant_id');
    });

    test('returns error if Pro plan is not found in DB', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);
      planRepo.findByName.mockResolvedValue(null); // Plan missing

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_no_plan',
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { tenantId: 'tenant-1' },
            subscription: 'sub_123',
          },
        },
      });

      expect(result.error).toBe('pro_plan_not_found');
    });
  });

  // ── customer.subscription.updated ───────────────────────────────
  describe('handleWebhookEvent — customer.subscription.updated', () => {
    test('maps active status correctly', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);
      subscriptionRepo.updateStatus.mockResolvedValue({ id: 'sub-1' });

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_status',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_stripe_1', status: 'active' } },
      });

      expect(result.action).toBe('status_updated');
      expect(result.status).toBe('active');
      expect(subscriptionRepo.updateStatus).toHaveBeenCalledWith('sub_stripe_1', 'active');
    });

    test('maps past_due status correctly', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);
      subscriptionRepo.updateStatus.mockResolvedValue({ id: 'sub-1' });

      await stripeService.handleWebhookEvent({
        id: 'evt_pd',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_s_2', status: 'past_due' } },
      });

      expect(subscriptionRepo.updateStatus).toHaveBeenCalledWith('sub_s_2', 'past_due');
    });

    test('maps trialing to active', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);
      subscriptionRepo.updateStatus.mockResolvedValue({ id: 'sub-1' });

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_trial',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_s_3', status: 'trialing' } },
      });

      expect(result.status).toBe('active');
    });

    test('maps incomplete_expired to canceled', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);
      subscriptionRepo.updateStatus.mockResolvedValue({ id: 'sub-1' });

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_ie',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_s_4', status: 'incomplete_expired' } },
      });

      expect(result.status).toBe('canceled');
    });
  });

  // ── customer.subscription.deleted ───────────────────────────────
  describe('handleWebhookEvent — customer.subscription.deleted', () => {
    test('marks subscription as canceled', async () => {
      stripeEventRepo.markProcessed.mockResolvedValue(true);
      subscriptionRepo.updateStatus.mockResolvedValue({ id: 'sub-1' });

      const result = await stripeService.handleWebhookEvent({
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_stripe_del' } },
      });

      expect(result.action).toBe('subscription_canceled');
      expect(subscriptionRepo.updateStatus).toHaveBeenCalledWith('sub_stripe_del', 'canceled');
    });
  });

  // ── Reconciliation ─────────────────────────────────────────────
  describe('reconcileSubscriptions', () => {
    test('skips when STRIPE_SECRET_KEY is not set', async () => {
      const original = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;

      await stripeService.reconcileSubscriptions();

      expect(subscriptionRepo.findAllActiveWithStripeId).not.toHaveBeenCalled();

      // Restore
      if (original) process.env.STRIPE_SECRET_KEY = original;
    });

    test('detects and fixes discrepancies', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

      subscriptionRepo.findAllActiveWithStripeId.mockResolvedValue([
        { id: 'sub-1', stripe_subscription_id: 'sub_stripe_1', status: 'active' },
        { id: 'sub-2', stripe_subscription_id: 'sub_stripe_2', status: 'active' },
      ]);

      // Stripe says sub-1 is canceled but our DB says active
      stripe.subscriptions.retrieve
        .mockResolvedValueOnce({ status: 'canceled' })
        .mockResolvedValueOnce({ status: 'active' });

      subscriptionRepo.updateStatus.mockResolvedValue({});

      await stripeService.reconcileSubscriptions();

      // Should only update sub-1 (the one with a discrepancy)
      expect(subscriptionRepo.updateStatus).toHaveBeenCalledTimes(1);
      expect(subscriptionRepo.updateStatus).toHaveBeenCalledWith('sub_stripe_1', 'canceled');

      delete process.env.STRIPE_SECRET_KEY;
    });

    test('handles Stripe API errors gracefully per subscription', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

      subscriptionRepo.findAllActiveWithStripeId.mockResolvedValue([
        { id: 'sub-1', stripe_subscription_id: 'sub_stripe_1', status: 'active' },
      ]);

      stripe.subscriptions.retrieve.mockRejectedValue(new Error('Stripe API down'));

      // Should not throw
      await expect(stripeService.reconcileSubscriptions()).resolves.not.toThrow();

      delete process.env.STRIPE_SECRET_KEY;
    });
  });

  // ── createCheckoutSession ───────────────────────────────────────
  describe('createCheckoutSession', () => {
    test('throws NotFoundError for unknown tenant', async () => {
      tenantRepo.findById.mockResolvedValue(null);

      await expect(
        stripeService.createCheckoutSession('unknown-id')
      ).rejects.toThrow(/not found/);
    });

    test('throws ConflictError if tenant is already on Pro', async () => {
      tenantRepo.findById.mockResolvedValue({ id: 't-1', name: 'Acme' });
      subscriptionRepo.getActiveSubscription.mockResolvedValue({ plan_name: 'pro' });

      await expect(
        stripeService.createCheckoutSession('t-1')
      ).rejects.toThrow(/already on the Pro plan/);
    });
  });
});
