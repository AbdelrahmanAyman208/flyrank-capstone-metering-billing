/**
 * Unit tests for the invoice service.
 *
 * Tests the genuinely tricky proration math, overage line items,
 * and the aggregation logic that turns raw events into invoices.
 */

jest.mock('../src/repositories/invoiceRepo');
jest.mock('../src/repositories/usageEventRepo');
jest.mock('../src/repositories/subscriptionRepo');

const invoiceRepo = require('../src/repositories/invoiceRepo');
const usageEventRepo = require('../src/repositories/usageEventRepo');
const subscriptionRepo = require('../src/repositories/subscriptionRepo');
const invoiceService = require('../src/services/invoiceService');
const pricing = require('../src/config/pricing');

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(); });
afterAll(() => { console.log.mockRestore(); });
afterEach(() => jest.clearAllMocks());

// ── Helpers ──────────────────────────────────────────────────────────
function mockProSubscription(createdAt = '2026-01-01T00:00:00Z') {
  return {
    id: 'sub-pro',
    tenant_id: 'tenant-1',
    plan_name: 'pro',
    status: 'active',
    created_at: createdAt,
  };
}

function mockFreeSubscription() {
  return {
    id: 'sub-free',
    tenant_id: 'tenant-1',
    plan_name: 'free',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
  };
}

function apiCallEvent(qty, overrideMeta = {}) {
  return {
    usage_type: 'api_call',
    quantity: qty,
    metadata: overrideMeta,
  };
}

function tokenEvent(qty, breakdown = {}, overrideMeta = {}) {
  return {
    usage_type: 'ai_tokens',
    quantity: qty,
    metadata: {
      input_tokens: breakdown.input || 0,
      cached_input_tokens: breakdown.cached || 0,
      output_tokens: breakdown.output || 0,
      reasoning_tokens: breakdown.reasoning || 0,
      ...overrideMeta,
    },
  };
}

describe('InvoiceService', () => {
  // ── No-op cases ────────────────────────────────────────────────
  describe('generateMonthlyInvoice — no-op', () => {
    test('returns null for free plan with no events', async () => {
      usageEventRepo.getEventsForMonth.mockResolvedValue([]);
      subscriptionRepo.findByTenantId.mockResolvedValue(mockFreeSubscription());

      const result = await invoiceService.generateMonthlyInvoice('tenant-1', '2026-01-01');

      expect(result).toBeNull();
      expect(invoiceRepo.createInvoice).not.toHaveBeenCalled();
    });
  });

  // ── API call invoicing ──────────────────────────────────────────
  describe('generateMonthlyInvoice — API calls only', () => {
    test('creates correct line items for API call usage', async () => {
      const events = [apiCallEvent(100), apiCallEvent(50)];
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(mockFreeSubscription());
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-01-01');

      expect(invoiceRepo.createInvoice).toHaveBeenCalledTimes(1);
      const [tenantId, month, totalCost, lineItems] = invoiceRepo.createInvoice.mock.calls[0];

      expect(tenantId).toBe('tenant-1');
      expect(totalCost).toBe(150 * pricing.API_CALL_RATE); // 150 × 500 = 75000

      const apiLine = lineItems.find(l => l.description === 'API Calls');
      expect(apiLine).toBeDefined();
      expect(apiLine.quantity).toBe(150);
    });
  });

  // ── Token invoicing ─────────────────────────────────────────────
  describe('generateMonthlyInvoice — AI tokens', () => {
    test('creates correct line items for mixed token usage', async () => {
      const events = [
        tokenEvent(1000, { input: 500, cached: 200, output: 200, reasoning: 100 }),
      ];
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(mockFreeSubscription());
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-01-01');

      const [, , totalCost, lineItems] = invoiceRepo.createInvoice.mock.calls[0];
      const expectedTokenCost =
        (500 * pricing.INPUT_TOKEN_RATE) +
        (200 * pricing.CACHED_INPUT_TOKEN_RATE) +
        (200 * pricing.OUTPUT_TOKEN_RATE) +
        (100 * pricing.REASONING_TOKEN_RATE);

      expect(totalCost).toBe(expectedTokenCost); // 450000
      expect(lineItems.find(l => l.description === 'AI Tokens (Mixed)')).toBeDefined();
    });
  });

  // ── Pro plan base fee ───────────────────────────────────────────
  describe('generateMonthlyInvoice — Pro base fee', () => {
    test('adds $50 base fee for Pro plan (full month)', async () => {
      const events = [apiCallEvent(10)];
      // Subscription created on the 1st → full month, no proration
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(
        mockProSubscription('2026-01-01T00:00:00Z')
      );
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-01-01');

      const [, , totalCost, lineItems] = invoiceRepo.createInvoice.mock.calls[0];
      const baseLine = lineItems.find(l => l.description === 'Pro Plan Base Fee');
      expect(baseLine).toBeDefined();
      expect(baseLine.amount).toBe(50_000_000); // $50 in microdollars

      // Total = base fee + API cost
      expect(totalCost).toBe(50_000_000 + (10 * pricing.API_CALL_RATE));
    });
  });

  // ── Proration — the genuinely tricky test ───────────────────────
  describe('generateMonthlyInvoice — proration', () => {
    test('prorates Pro base fee for mid-month upgrade on the 15th of a 31-day month', async () => {
      const events = [apiCallEvent(5)];
      // Upgrade on January 15 → 17 active days out of 31 in January
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(
        mockProSubscription('2026-01-15T10:30:00Z')
      );
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-01-01');

      const [, , , lineItems] = invoiceRepo.createInvoice.mock.calls[0];
      const baseLine = lineItems.find(l => l.description.includes('Prorated'));

      expect(baseLine).toBeDefined();
      // January has 31 days. Upgraded on 15th → 31 - 15 + 1 = 17 active days
      const expectedFee = Math.floor(50_000_000 * (17 / 31));
      expect(baseLine.amount).toBe(expectedFee);
      expect(baseLine.description).toContain('17/31');
    });

    test('prorates correctly for February (28 days)', async () => {
      const events = [apiCallEvent(1)];
      // Upgrade on Feb 20 → 9 active days out of 28 in Feb 2026
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(
        mockProSubscription('2026-02-20T00:00:00Z')
      );
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-02-01');

      const [, , , lineItems] = invoiceRepo.createInvoice.mock.calls[0];
      const baseLine = lineItems.find(l => l.description.includes('Prorated'));
      expect(baseLine).toBeDefined();
      // Feb 2026 has 28 days. Upgraded on 20th → 28 - 20 + 1 = 9 active days
      const expectedFee = Math.floor(50_000_000 * (9 / 28));
      expect(baseLine.amount).toBe(expectedFee);
      expect(baseLine.description).toContain('9/28');
    });

    test('does NOT prorate when subscription created on the 1st', async () => {
      const events = [apiCallEvent(1)];
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(
        mockProSubscription('2026-03-01T00:00:00Z')
      );
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-03-01');

      const [, , , lineItems] = invoiceRepo.createInvoice.mock.calls[0];
      const baseLine = lineItems.find(l => l.description === 'Pro Plan Base Fee');
      expect(baseLine).toBeDefined();
      expect(baseLine.amount).toBe(50_000_000); // Full fee, no proration
    });

    test('does NOT prorate when subscription is from a different month', async () => {
      const events = [apiCallEvent(1)];
      // Subscription from December, invoice for January → full month
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(
        mockProSubscription('2025-12-15T00:00:00Z')
      );
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-01-01');

      const [, , , lineItems] = invoiceRepo.createInvoice.mock.calls[0];
      const baseLine = lineItems.find(l => l.description === 'Pro Plan Base Fee');
      expect(baseLine).toBeDefined();
      expect(baseLine.amount).toBe(50_000_000);
    });
  });

  // ── Overage line items ──────────────────────────────────────────
  describe('generateMonthlyInvoice — overage charges', () => {
    test('adds overage line item when events have overage metadata', async () => {
      const events = [
        apiCallEvent(100, { is_overage: true, overage_quantity: 20 }),
      ];
      usageEventRepo.getEventsForMonth.mockResolvedValue(events);
      subscriptionRepo.findByTenantId.mockResolvedValue(mockFreeSubscription());
      invoiceRepo.createInvoice.mockResolvedValue({ id: 'inv-1' });

      await invoiceService.generateMonthlyInvoice('tenant-1', '2026-01-01');

      const [, , , lineItems] = invoiceRepo.createInvoice.mock.calls[0];
      const overageLine = lineItems.find(l => l.description.includes('Overage'));
      expect(overageLine).toBeDefined();
      expect(overageLine.quantity).toBe(20);
    });
  });
});
