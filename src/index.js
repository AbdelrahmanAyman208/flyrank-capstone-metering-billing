/**
 * Express application bootstrap.
 * 
 * IMPORTANT: The webhook route MUST receive the raw body (not JSON-parsed)
 * for Stripe signature verification. We achieve this by:
 * 1. Mounting the webhook route BEFORE the JSON body parser
 * 2. Using express.raw() for the webhook path
 * 3. Using express.json() for everything else
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const errorHandler = require('./middleware/errorHandler');
const { startBackgroundJobs } = require('./services/backgroundJobs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Webhook route (raw body, BEFORE json parser) ────────────────────────
// Stripe needs the raw bytes for signature verification.
// req.rawBody is set for the webhook handler to use.
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body;  // express.raw() puts Buffer in req.body
  next();
});

// ─── JSON body parser (for all other routes) ─────────────────────────────
app.use(express.json());

// ─── Static files (dashboard) ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── API Routes ──────────────────────────────────────────────────────────
app.use('/generate', require('./routes/generate'));
app.use('/usage', require('./routes/usage'));
app.use('/checkout', require('./routes/checkout'));
app.use('/webhooks/stripe', require('./routes/webhooks'));
app.use('/alerts', require('./routes/alerts'));
app.use('/invoices', require('./routes/invoices'));
app.use('/tests', require('./routes/testRunner'));

// ─── Health check ────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Global error handler (must be last) ─────────────────────────────────
app.use(errorHandler);

// ─── Start server ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Metering & Billing Engine running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database: ${process.env.DATABASE_URL ? '✓ configured' : '✖ missing DATABASE_URL'}`);
  console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY ? '✓ configured' : '✖ missing STRIPE_SECRET_KEY'}`);
  console.log('');

  // Start background jobs
  startBackgroundJobs();
});

module.exports = app;
