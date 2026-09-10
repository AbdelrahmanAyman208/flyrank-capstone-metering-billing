/**
 * Background jobs — runs off the request path.
 * 
 * Monthly usage rollup job:
 * - Runs on the 1st of each month at midnight (configurable)
 * - Aggregates the previous month's usage per tenant
 * - Stores summary rows for fast historical queries
 * - Retry logic: up to 3 attempts with exponential backoff
 * - Logs success/failure as structured messages (serves as the "alert")
 */

const cron = require('node-cron');
const tenantRepo = require('../repositories/tenantRepo');
const usageEventRepo = require('../repositories/usageEventRepo');
const usageSummaryRepo = require('../repositories/usageSummaryRepo');
const costService = require('./costService');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 4s, 16s (exponential)

/**
 * Sleep utility for retry backoff.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run the monthly rollup for a single tenant.
 */
async function rollupTenant(tenantId, monthStart) {
  const events = await usageEventRepo.getEventsForMonth(tenantId, monthStart);

  let apiCallsTotal = 0;
  let aiTokensTotal = 0;

  for (const event of events) {
    if (event.usage_type === 'api_call') {
      apiCallsTotal += event.quantity;
    } else if (event.usage_type === 'ai_tokens') {
      aiTokensTotal += event.quantity;
    }
  }

  const costResult = costService.calculateTotalCost(events);

  await usageSummaryRepo.upsert({
    tenantId,
    month: monthStart,
    apiCallsTotal,
    aiTokensTotal,
    costMicrodollars: costResult.total.costMicrodollars,
  });

  return { apiCallsTotal, aiTokensTotal, costMicrodollars: costResult.total.costMicrodollars };
}

/**
 * Run the full monthly rollup for all tenants, with retry logic.
 */
async function runMonthlyRollup() {
  // Calculate the previous month's start date
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStart = prevMonth.toISOString().slice(0, 10); // YYYY-MM-DD

  console.log(`[BackgroundJob] Starting monthly usage rollup for ${monthStart}`);

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      const tenants = await tenantRepo.findAll();
      let processed = 0;

      const invoiceService = require('./invoiceService');
      for (const tenant of tenants) {
        const result = await rollupTenant(tenant.id, monthStart);
        // Generate invoice
        await invoiceService.generateMonthlyInvoice(tenant.id, monthStart);
        console.log(
          `[BackgroundJob] Rollup & Invoice complete: tenant=${tenant.id} ` +
          `apiCalls=${result.apiCallsTotal} aiTokens=${result.aiTokensTotal} ` +
          `cost=${result.costMicrodollars} microdollars`
        );
        processed++;
      }

      console.log(
        `[BackgroundJob] ✔ Monthly rollup complete: ${processed} tenants processed for ${monthStart}`
      );
      return; // Success — exit retry loop

    } catch (err) {
      const delay = BASE_DELAY_MS * Math.pow(4, attempt - 1);
      console.error(
        `[BackgroundJob] ✖ Rollup attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`
      );

      if (attempt < MAX_RETRIES) {
        console.log(`[BackgroundJob] Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        // Final failure — log an alert
        console.error(
          `[BackgroundJob] ⚠ ALERT: Monthly rollup for ${monthStart} FAILED after ${MAX_RETRIES} attempts. ` +
          `Manual intervention required. Error: ${err.message}`
        );
      }
    }
  }
}

/**
 * Start the background cron scheduler.
 * Default: runs at midnight on the 1st of every month.
 */
function startBackgroundJobs() {
  // Cron: minute=0, hour=0, day-of-month=1, month=*, day-of-week=*
  const schedule = process.env.ROLLUP_CRON || '0 0 1 * *';

  cron.schedule(schedule, () => {
    console.log(`[BackgroundJob] Cron triggered: starting monthly rollup`);
    runMonthlyRollup().catch(err => {
      console.error(`[BackgroundJob] Unexpected error in cron handler:`, err.message);
    });
  });

  console.log(`[BackgroundJob] Monthly rollup job scheduled: "${schedule}"`);

  // Nightly Stripe reconciliation cron: every day at 3:00 AM
  const reconcileSchedule = process.env.RECONCILE_CRON || '0 3 * * *';
  cron.schedule(reconcileSchedule, () => {
    console.log(`[BackgroundJob] Cron triggered: starting Stripe reconciliation`);
    const stripeService = require('./stripeService');
    stripeService.reconcileSubscriptions().catch(err => {
      console.error(`[BackgroundJob] Unexpected error in reconciliation handler:`, err.message);
    });
  });
  console.log(`[BackgroundJob] Stripe reconciliation job scheduled: "${reconcileSchedule}"`);
}

module.exports = { startBackgroundJobs, runMonthlyRollup };
