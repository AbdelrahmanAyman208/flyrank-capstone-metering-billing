/**
 * Invoice service — generates monthly invoices from usage summaries.
 */
const invoiceRepo = require('../repositories/invoiceRepo');
const costService = require('./costService');
const usageEventRepo = require('../repositories/usageEventRepo');
const subscriptionRepo = require('../repositories/subscriptionRepo');
const pricing = require('../config/pricing');

const invoiceService = {
  /**
   * Generates an invoice for a given tenant and month.
   */
  async generateMonthlyInvoice(tenantId, monthStart) {
    // 1. Fetch all usage events for the month to calculate precise line items
    const events = await usageEventRepo.getEventsForMonth(tenantId, monthStart);
    const sub = await subscriptionRepo.findByTenantId(tenantId);
    
    if (events.length === 0 && (!sub || sub.plan_name === 'free')) {
      return null; // Nothing to invoice
    }

    let apiCallCost = 0;
    let aiTokenCost = 0;
    let apiCallQty = 0;
    let aiTokenQty = 0;
    let overageCost = 0;
    let overageQty = 0;

    for (const event of events) {
      const eventCost = costService.calculateEventCost(event);
      const meta = event.metadata || {};

      if (event.usage_type === 'api_call') {
        apiCallQty += event.quantity;
        apiCallCost += eventCost;
      } else if (event.usage_type === 'ai_tokens') {
        aiTokenQty += event.quantity;
        aiTokenCost += eventCost;
      }

      if (meta.is_overage) {
        // Approximate overage cost for the line item display
        const markup = Math.floor( (eventCost / event.quantity) * (meta.overage_quantity || 0) * (pricing.OVERAGE_MULTIPLIER - 1) );
        overageCost += markup;
        overageQty += (meta.overage_quantity || 0);
      }
    }

    const lineItems = [];

    // Add base plan fee if pro
    let totalCost = 0;
    if (sub && sub.plan_name === 'pro') {
      // Assuming a mock $50 base fee for Pro plan (50,000,000 microdollars)
      const baseFee = 50_000_000;
      let actualFee = baseFee;
      let description = 'Pro Plan Base Fee';

      const subDate = new Date(sub.created_at);
      const monthStartDate = new Date(monthStart);

      // Prorate if upgraded mid-month
      if (subDate.getFullYear() === monthStartDate.getFullYear() && 
          subDate.getMonth() === monthStartDate.getMonth() && 
          subDate.getDate() > 1) {
        const daysInMonth = new Date(monthStartDate.getFullYear(), monthStartDate.getMonth() + 1, 0).getDate();
        const activeDays = daysInMonth - subDate.getDate() + 1;
        actualFee = Math.floor(baseFee * (activeDays / daysInMonth));
        description = `Pro Plan Base Fee (Prorated for ${activeDays}/${daysInMonth} days)`;
      }

      lineItems.push({
        description,
        quantity: 1,
        unitPrice: baseFee,
        amount: actualFee
      });
      totalCost += actualFee;
    }

    if (apiCallQty > 0) {
      lineItems.push({
        description: 'API Calls',
        quantity: apiCallQty,
        unitPrice: pricing.API_CALL_RATE,
        amount: apiCallCost - (overageCost > 0 && events.some(e => e.usage_type === 'api_call' && e.metadata?.is_overage) ? overageCost : 0) // rough estimation for display
      });
      totalCost += apiCallCost;
    }

    if (aiTokenQty > 0) {
      lineItems.push({
        description: 'AI Tokens (Mixed)',
        quantity: aiTokenQty,
        unitPrice: 0, // variable
        amount: aiTokenCost - (overageCost > 0 && events.some(e => e.usage_type === 'ai_tokens' && e.metadata?.is_overage) ? overageCost : 0)
      });
      totalCost += aiTokenCost;
    }

    if (overageCost > 0) {
      lineItems.push({
        description: 'Overage Charges (1.5x Rate)',
        quantity: overageQty,
        unitPrice: 0,
        amount: overageCost
      });
    }

    // Insert into DB
    const invoice = await invoiceRepo.createInvoice(tenantId, monthStart, totalCost, lineItems);
    
    console.log(`[InvoiceService] Generated invoice for tenant ${tenantId} - ${monthStart} for $${costService.microdollarsToDollars(totalCost)}`);
    return invoice;
  }
};

module.exports = invoiceService;
