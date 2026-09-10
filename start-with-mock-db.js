/**
 * Bootstraps the application using an IN-MEMORY Postgres emulator (pg-mem).
 * This allows testing the application without a real Postgres instance.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const { newDb } = require('pg-mem');
const { v4: uuidv4 } = require('uuid');

async function start() {
  console.log('🔄 Setting up in-memory PostgreSQL emulator (pg-mem)...');

  // Create in-memory database
  const db = newDb();

  // Register missing Postgres functions
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    implementation: () => uuidv4(),
    impure: true,
  });

  // Mock the pg.Pool so all require('pg') use the in-memory DB
  const { Pool } = db.adapters.createPg();
  pg.Pool = Pool;

  const pool = new Pool();

  // Intercept pool.query to remove date_trunc which pg-mem doesn't support
  const originalQuery = Pool.prototype.query;
  Pool.prototype.query = function (text, values, cb) {
    let sql = typeof text === 'string' ? text : text.text;
    if (sql) {
      sql = sql.replace(/date_trunc\('month', NOW\(\)\)\s*\+\s*INTERVAL '1 month'/gi, "'2030-01-01'");
      sql = sql.replace(/date_trunc\('month', NOW\(\)\)/gi, "'2020-01-01'");

      // pg-mem hack for UUIDs
      if (sql.includes('INSERT INTO usage_events (tenant_id')) {
        sql = sql.replace('INSERT INTO usage_events (tenant_id', 'INSERT INTO usage_events (id, tenant_id');
        sql = sql.replace('VALUES ($1', `VALUES ('${uuidv4()}', $1`);
      }

      if (typeof text === 'string') text = sql;
      else text.text = sql;
    }
    return originalQuery.call(this, text, values, cb);
  };

  // 1. Run Migrations
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    let sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // pg-mem compatibility hacks
    sql = sql.replace(/date_trunc\('month', NOW\(\)\)/g, "NOW()");

    try {
      await pool.query(sql);
      console.log(`  ✓ Applied migration: ${file}`);
    } catch (e) {
      console.error(`  ✖ Failed migration ${file}:`, e.message);
      process.exit(1);
    }
  }

  // 2. Run Seeds (manually since we intercepted pg)
  console.log('🌱 Seeding demo data...');
  const planDefs = require('./src/config/plans');

  const freePlanId = uuidv4();
  const proPlanId = uuidv4();
  await pool.query(
    `INSERT INTO plans (id, name, display_name, api_call_limit, ai_token_limit, price_cents) VALUES 
     ($1, $2, $3, $4, $5, $6),
     ($7, $8, $9, $10, $11, $12)`,
    [
      freePlanId, planDefs.FREE.name, planDefs.FREE.displayName, planDefs.FREE.apiCallLimit, planDefs.FREE.aiTokenLimit, planDefs.FREE.priceCents,
      proPlanId, planDefs.PRO.name, planDefs.PRO.displayName, planDefs.PRO.apiCallLimit, planDefs.PRO.aiTokenLimit, planDefs.PRO.priceCents
    ]
  );

  const acmeId = uuidv4();
  const techId = uuidv4();
  await pool.query(
    `INSERT INTO tenants (id, name, email) VALUES 
     ($1, 'Acme Corp', 'billing@acmecorp.dev'), 
     ($2, 'TechStart Inc', 'ops@techstart.io')`,
    [acmeId, techId]
  );

  const sub1 = uuidv4();
  const sub2 = uuidv4();
  await pool.query(`INSERT INTO subscriptions (id, tenant_id, plan_id, status) VALUES ($1, $2, $3, 'active')`, [sub1, acmeId, freePlanId]);
  await pool.query(`INSERT INTO subscriptions (id, tenant_id, plan_id, status) VALUES ($1, $2, $3, 'active')`, [sub2, techId, proPlanId]);

  console.log(`  ✓ Demo tenants created:`);
  console.log(`    Acme Corp (Free):    ${acmeId}`);
  console.log(`    TechStart Inc (Pro): ${techId}`);

  // Patch usageEventRepo to bypass pg-mem ON CONFLICT bug
  const usageEventRepo = require('./src/repositories/usageEventRepo');
  const originalInsert = usageEventRepo.insertEvent;
  usageEventRepo.insertEvent = async function (args) {
    const { rows } = await pool.query('SELECT * FROM usage_events WHERE idempotency_key = $1', [args.idempotencyKey]);
    if (rows.length > 0) {
      return { event: rows[0], wasNew: false };
    }
    return originalInsert.call(this, args);
  };

  // Patch invoiceRepo.createInvoice to bypass pool.connect() (pg-mem limitation)
  const invoiceRepo = require('./src/repositories/invoiceRepo');
  invoiceRepo.createInvoice = async function (tenantId, month, totalAmount, lineItems) {
    // Check if invoice already exists for this tenant+month (pg-mem doesn't handle ON CONFLICT well)
    const existing = await pool.query(
      `SELECT * FROM invoices WHERE tenant_id = $1 AND billing_month = $2`,
      [tenantId, month]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0]; // Already exists, skip
    }

    const invId = uuidv4();
    await pool.query(
      `INSERT INTO invoices (id, tenant_id, billing_month, total_amount_microdollars, status) VALUES ($1, $2, $3, $4, 'finalized')`,
      [invId, tenantId, month, totalAmount]
    );

    for (const item of lineItems) {
      const itemId = uuidv4();
      await pool.query(
        `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price_microdollars, amount_microdollars) VALUES ($1, $2, $3, $4, $5, $6)`,
        [itemId, invId, item.description, item.quantity, item.unitPrice, item.amount]
      );
    }

    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [invId]);
    return rows[0];
  };

  // 3. Start the Express App (with mock upgrade route)
  console.log('\n🚀 Starting application...');

  // Require the app but intercept it to add a mock upgrade route
  // We need to add the route BEFORE the error handler middleware
  const subscriptionRepo = require('./src/repositories/subscriptionRepo');
  const planRepo = require('./src/repositories/planRepo');

  // Patch subscriptionRepo.upgradePlan to avoid pool.connect() (pg-mem limitation)
  subscriptionRepo.upgradePlan = async function (tenantId, newPlanId, stripeSubscriptionId) {
    // Cancel existing active subscriptions
    await pool.query(
      `UPDATE subscriptions SET status = 'canceled' WHERE tenant_id = $1 AND status IN ('active', 'past_due')`,
      [tenantId]
    );
    // Create new Pro subscription
    const newSubId = uuidv4();
    await pool.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, stripe_subscription_id) VALUES ($1, $2, $3, 'active', $4)`,
      [newSubId, tenantId, newPlanId, stripeSubscriptionId]
    );
    const { rows } = await pool.query('SELECT * FROM subscriptions WHERE id = $1', [newSubId]);
    return rows[0];
  };

  // Now require the app
  const app = require('./src/index.js');

  // Add mock upgrade route (mounted on the running Express app)
  const express = require('express');
  app.post('/mock-upgrade', express.json(), async (req, res) => {
    try {
      const { tenantId } = req.body;
      if (!tenantId) {
        return res.status(400).json({ error: { message: 'tenantId is required' } });
      }

      // Check current subscription
      const sub = await subscriptionRepo.getActiveSubscription(tenantId);
      if (!sub) {
        return res.status(404).json({ error: { message: 'No active subscription found for this tenant' } });
      }
      if (sub.plan_name === 'pro') {
        return res.status(409).json({ error: { message: 'Tenant is already on the Pro plan' } });
      }

      // Find Pro plan
      const proPlan = await planRepo.findByName('pro');
      if (!proPlan) {
        return res.status(500).json({ error: { message: 'Pro plan not found in database' } });
      }

      // Upgrade directly (no Stripe needed)
      const newSub = await subscriptionRepo.upgradePlan(tenantId, proPlan.id, 'mock_stripe_sub_' + Date.now());

      // Simulate a mid-month upgrade in the PREVIOUS month so it shows up in the current invoice run
      const midMonth = new Date();
      midMonth.setMonth(midMonth.getMonth() - 1);
      midMonth.setDate(15);
      await pool.query(`UPDATE subscriptions SET created_at = $1 WHERE id = $2`, [midMonth, newSub.id]);
      newSub.created_at = midMonth;

      console.log(`[MockUpgrade] Tenant ${tenantId} upgraded to Pro (simulated mid-cycle on ${midMonth.toISOString().split('T')[0]})`);
      res.json({
        success: true,
        message: 'Upgraded to Pro plan successfully (simulated mid-cycle)!',
        subscription: newSub
      });
    } catch (err) {
      console.error('[MockUpgrade] Error:', err.message);
      res.status(500).json({ error: { message: err.message } });
    }
  });
}

start().catch(console.error);
