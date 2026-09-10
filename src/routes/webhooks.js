/**
 * POST /webhooks/stripe — Stripe webhook receiver.
 * 
 * CRITICAL: This route MUST receive the raw request body (not parsed JSON)
 * because Stripe's signature verification hashes the raw bytes.
 * 
 * Security flow:
 * 1. Verify webhook signature using STRIPE_WEBHOOK_SECRET
 * 2. Reject with 400 if signature is invalid (forged/tampered)
 * 3. Deduplicate by event ID (handled by stripeService)
 * 4. Process the event (update subscription state)
 * 
 * The raw body middleware is configured in index.js — this route
 * expects req.rawBody to be available.
 */

const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const stripeService = require('../services/stripeService');

router.post('/', async (req, res, next) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    return res.status(400).json({
      error: { code: 'MISSING_SIGNATURE', message: 'Missing stripe-signature header' },
    });
  }

  let event;

  try {
    // Verify the webhook signature — this is the security boundary.
    // A forged signature will throw, returning 400 and changing nothing.
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`[Webhook] Signature verification failed: ${err.message}`);
    return res.status(400).json({
      error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
    });
  }

  try {
    // Process the verified event (includes deduplication)
    const result = await stripeService.handleWebhookEvent(event);
    res.json({ received: true, result });
  } catch (err) {
    // Log but still return 200 to Stripe — we don't want Stripe to retry
    // if our business logic fails (we handle retries internally)
    console.error(`[Webhook] Error processing event ${event.id}:`, err.message);
    res.json({ received: true, error: err.message });
  }
});

module.exports = router;
