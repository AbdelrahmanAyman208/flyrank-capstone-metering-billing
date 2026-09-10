/**
 * Stripe service — handles Checkout session creation and webhook event processing.
 * 
 * All plan/subscription changes flow through verified Stripe webhooks ONLY.
 * The checkout endpoint creates a session; it does NOT modify the database.
 * The database is updated exclusively by webhook handlers after signature verification.
 */

const stripe = require('../config/stripe');
const tenantRepo = require('../repositories/tenantRepo');
const planRepo = require('../repositories/planRepo');
const subscriptionRepo = require('../repositories/subscriptionRepo');
const stripeEventRepo = require('../repositories/stripeEventRepo');
const { NotFoundError, ConflictError } = require('../utils/errors');

const stripeService = {
  /**
   * Create a Stripe Checkout session for upgrading to Pro.
   * Returns the session URL for redirect.
   */
  async createCheckoutSession(tenantId) {
    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant', tenantId);
    }

    // Check if already on Pro
    const sub = await subscriptionRepo.getActiveSubscription(tenantId);
    if (sub && sub.plan_name === 'pro') {
      throw new ConflictError('Tenant is already on the Pro plan');
    }

    // Create or reuse Stripe customer
    let stripeCustomerId = tenant.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: tenant.name,
        email: tenant.email,
        metadata: { tenantId: tenant.id },
      });
      stripeCustomerId = customer.id;
      await tenantRepo.updateStripeCustomerId(tenantId, stripeCustomerId);
    }

    // Create Checkout session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{
        price: process.env.STRIPE_PRO_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${process.env.APP_URL || 'http://localhost:3000'}/?tenantId=${tenantId}&checkout=success`,
      cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/?tenantId=${tenantId}&checkout=canceled`,
      metadata: { tenantId: tenant.id },
    });

    console.log(`[Stripe] Checkout session created: session=${session.id} tenant=${tenantId}`);
    return { url: session.url };
  },

  /**
   * Process a verified Stripe webhook event.
   * 
   * Deduplication: checks stripe_events table before processing.
   * If the event ID already exists, returns early — processing is skipped.
   */
  async handleWebhookEvent(event) {
    // Deduplicate: skip if we've already processed this event
    const isNew = await stripeEventRepo.markProcessed(event.id, event.type);
    if (!isNew) {
      console.log(`[Stripe] Duplicate event skipped: ${event.id} (${event.type})`);
      return { skipped: true, reason: 'duplicate_event' };
    }

    console.log(`[Stripe] Processing event: ${event.id} (${event.type})`);

    switch (event.type) {
      case 'checkout.session.completed':
        return await stripeService._handleCheckoutCompleted(event.data.object);

      case 'customer.subscription.updated':
        return await stripeService._handleSubscriptionUpdated(event.data.object);

      case 'customer.subscription.deleted':
        return await stripeService._handleSubscriptionDeleted(event.data.object);

      default:
        console.log(`[Stripe] Unhandled event type: ${event.type}`);
        return { skipped: true, reason: 'unhandled_event_type' };
    }
  },

  /**
   * Handle checkout.session.completed — upgrade tenant to Pro.
   */
  async _handleCheckoutCompleted(session) {
    const tenantId = session.metadata?.tenantId;
    if (!tenantId) {
      console.error('[Stripe] checkout.session.completed missing tenantId in metadata');
      return { error: 'missing_tenant_id' };
    }

    const proPlan = await planRepo.findByName('pro');
    if (!proPlan) {
      console.error('[Stripe] Pro plan not found in database');
      return { error: 'pro_plan_not_found' };
    }

    // Upgrade: cancel existing Free subscription, create new Pro subscription
    const subscription = await subscriptionRepo.upgradePlan(
      tenantId,
      proPlan.id,
      session.subscription  // Stripe subscription ID from the checkout
    );

    console.log(`[Stripe] Tenant ${tenantId} upgraded to Pro (stripe_sub=${session.subscription})`);
    return { action: 'upgraded_to_pro', tenantId, subscriptionId: subscription.id };
  },

  /**
   * Handle customer.subscription.updated — sync status changes.
   */
  async _handleSubscriptionUpdated(stripeSubscription) {
    const statusMap = {
      'active': 'active',
      'past_due': 'past_due',
      'canceled': 'canceled',
      'incomplete': 'incomplete',
      'incomplete_expired': 'canceled',
      'trialing': 'active',
      'unpaid': 'past_due',
    };

    const newStatus = statusMap[stripeSubscription.status] || 'canceled';

    const updated = await subscriptionRepo.updateStatus(
      stripeSubscription.id,
      newStatus
    );

    if (updated) {
      console.log(`[Stripe] Subscription ${stripeSubscription.id} status → ${newStatus}`);
    } else {
      console.log(`[Stripe] Subscription ${stripeSubscription.id} not found in DB (may be new)`);
    }

    return { action: 'status_updated', status: newStatus };
  },

  /**
   * Handle customer.subscription.deleted — mark as canceled.
   */
  async _handleSubscriptionDeleted(stripeSubscription) {
    const updated = await subscriptionRepo.updateStatus(
      stripeSubscription.id,
      'canceled'
    );

    if (updated) {
      console.log(`[Stripe] Subscription ${stripeSubscription.id} canceled`);
    }

    return { action: 'subscription_canceled' };
  },

  /**
   * Nightly job to verify DB status against Stripe.
   * Catches any missed webhooks.
   */
  async reconcileSubscriptions() {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.log('[Stripe] Reconciliation skipped: STRIPE_SECRET_KEY not set.');
      return;
    }
    
    console.log('[Stripe] Starting subscription reconciliation...');
    const subscriptions = await subscriptionRepo.findAllActiveWithStripeId();
    
    let discrepancies = 0;
    for (const sub of subscriptions) {
      try {
        // Fetch current status from Stripe
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        
        const statusMap = {
          'active': 'active',
          'past_due': 'past_due',
          'canceled': 'canceled',
          'incomplete': 'incomplete',
          'incomplete_expired': 'canceled',
          'trialing': 'active',
          'unpaid': 'past_due',
        };
        
        const expectedStatus = statusMap[stripeSub.status] || 'canceled';
        
        if (sub.status !== expectedStatus) {
           await subscriptionRepo.updateStatus(sub.stripe_subscription_id, expectedStatus);
           console.log(`[Stripe] Reconciled sub ${sub.id}: ${sub.status} -> ${expectedStatus}`);
           discrepancies++;
        }
      } catch(err) {
         console.error(`[Stripe] Error reconciling ${sub.id}:`, err.message);
      }
    }
    console.log(`[Stripe] Reconciliation complete. Found ${discrepancies} discrepancies.`);
  }
};

module.exports = stripeService;
