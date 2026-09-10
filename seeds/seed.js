/**
 * Seed script — populates the database with initial data.
 * 
 * Creates:
 * - Free and Pro plans (matching config/plans.js)
 * - Two demo tenants: "Acme Corp" (Free) and "TechStart Inc" (Pro)
 * - Active subscriptions for both tenants
 * 
 * Safe to re-run: uses INSERT ... ON CONFLICT DO NOTHING for plans,
 * and checks for existing tenants before inserting.
 */

require('dotenv').config();
const { Pool } = require('pg');
const planDefs = require('../src/config/plans');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 1. Seed plans ────────────────────────────────────────────
    console.log('Seeding plans...');

    // Insert Free plan
    const { rows: [freePlan] } = await client.query(
      `INSERT INTO plans (name, display_name, api_call_limit, ai_token_limit, price_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         api_call_limit = EXCLUDED.api_call_limit,
         ai_token_limit = EXCLUDED.ai_token_limit,
         price_cents = EXCLUDED.price_cents
       RETURNING *`,
      [planDefs.FREE.name, planDefs.FREE.displayName, planDefs.FREE.apiCallLimit, planDefs.FREE.aiTokenLimit, planDefs.FREE.priceCents]
    );
    console.log(`  ✔ Free plan: ${freePlan.id} (${freePlan.api_call_limit} API calls, ${freePlan.ai_token_limit} AI tokens)`);

    // Insert Pro plan
    const { rows: [proPlan] } = await client.query(
      `INSERT INTO plans (name, display_name, api_call_limit, ai_token_limit, price_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         api_call_limit = EXCLUDED.api_call_limit,
         ai_token_limit = EXCLUDED.ai_token_limit,
         price_cents = EXCLUDED.price_cents
       RETURNING *`,
      [planDefs.PRO.name, planDefs.PRO.displayName, planDefs.PRO.apiCallLimit, planDefs.PRO.aiTokenLimit, planDefs.PRO.priceCents]
    );
    console.log(`  ✔ Pro plan: ${proPlan.id} (${proPlan.api_call_limit} API calls, ${proPlan.ai_token_limit} AI tokens)`);

    // ── 2. Seed demo tenants ─────────────────────────────────────
    console.log('\nSeeding demo tenants...');

    // Check for existing tenants (skip if already seeded)
    const { rows: existingTenants } = await client.query(
      `SELECT * FROM tenants WHERE name IN ('Acme Corp', 'TechStart Inc')`
    );

    let acme, techstart;

    if (existingTenants.length >= 2) {
      console.log('  ℹ Demo tenants already exist, skipping creation');
      acme = existingTenants.find(t => t.name === 'Acme Corp');
      techstart = existingTenants.find(t => t.name === 'TechStart Inc');
    } else {
      // Create Acme Corp (Free plan tenant)
      const { rows: [a] } = await client.query(
        `INSERT INTO tenants (name, email) VALUES ($1, $2) RETURNING *`,
        ['Acme Corp', 'billing@acmecorp.dev']
      );
      acme = a;
      console.log(`  ✔ Acme Corp: ${acme.id}`);

      // Create TechStart Inc (Pro plan tenant)
      const { rows: [t] } = await client.query(
        `INSERT INTO tenants (name, email) VALUES ($1, $2) RETURNING *`,
        ['TechStart Inc', 'ops@techstart.io']
      );
      techstart = t;
      console.log(`  ✔ TechStart Inc: ${techstart.id}`);
    }

    // ── 3. Seed subscriptions ────────────────────────────────────
    console.log('\nSeeding subscriptions...');

    // Check for existing active subscriptions
    const { rows: existingSubs } = await client.query(
      `SELECT tenant_id FROM subscriptions WHERE status = 'active'`
    );
    const activeSet = new Set(existingSubs.map(s => s.tenant_id));

    if (acme && !activeSet.has(acme.id)) {
      await client.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status)
         VALUES ($1, $2, 'active')`,
        [acme.id, freePlan.id]
      );
      console.log(`  ✔ Acme Corp → Free plan`);
    } else {
      console.log(`  ℹ Acme Corp already has an active subscription`);
    }

    if (techstart && !activeSet.has(techstart.id)) {
      await client.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status)
         VALUES ($1, $2, 'active')`,
        [techstart.id, proPlan.id]
      );
      console.log(`  ✔ TechStart Inc → Pro plan`);
    } else {
      console.log(`  ℹ TechStart Inc already has an active subscription`);
    }

    await client.query('COMMIT');

    console.log('\n✅ Seed complete!');
    console.log('\n📋 Tenant IDs for testing:');
    if (acme) console.log(`   Acme Corp (Free):     ${acme.id}`);
    if (techstart) console.log(`   TechStart Inc (Pro):  ${techstart.id}`);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
