/**
 * Stripe client initialization.
 * 
 * Uses STRIPE_SECRET_KEY from env — test mode only.
 * This file is the single place Stripe is configured.
 */

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-04-10',
});

module.exports = stripe;
