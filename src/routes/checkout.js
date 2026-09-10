/**
 * POST /checkout — creates a Stripe Checkout session for upgrading to Pro.
 * 
 * Does NOT modify the database. Plan changes happen exclusively via
 * the webhook handler after Stripe confirms the payment.
 */

const express = require('express');
const router = express.Router();
const { validate } = require('../middleware/validateInput');
const stripeService = require('../services/stripeService');

const checkoutValidation = validate({
  tenantId: { type: 'string', required: true },
}, 'body');

router.post('/', checkoutValidation, async (req, res, next) => {
  try {
    const { tenantId } = req.body;
    const result = await stripeService.createCheckoutSession(tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
