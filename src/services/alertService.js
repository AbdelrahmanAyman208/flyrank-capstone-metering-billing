/**
 * Alert service — checks thresholds and triggers UI notifications.
 */
const alertRepo = require('../repositories/alertRepo');

const alertService = {
  /**
   * Check if usage crossed a threshold and trigger an alert if so.
   */
  async checkAndTriggerAlerts(tenantId, usageType, currentUsage, limit, requestedQuantity) {
    if (limit <= 0) return;

    const previousUsage = currentUsage;
    const newUsage = currentUsage + requestedQuantity;

    const previousPct = (previousUsage / limit) * 100;
    const newPct = (newUsage / limit) * 100;

    // Check 100% threshold
    if (newPct >= 100 && previousPct < 100) {
      const inserted = await alertRepo.insertAlert(tenantId, usageType, 100);
      if (inserted) {
        console.log(`[Alert] Tenant ${tenantId} reached 100% of ${usageType} quota.`);
      }
    } 
    // Check 80% threshold
    else if (newPct >= 80 && previousPct < 80) {
      const inserted = await alertRepo.insertAlert(tenantId, usageType, 80);
      if (inserted) {
        console.log(`[Alert] Tenant ${tenantId} reached 80% of ${usageType} quota.`);
      }
    }
  }
};

module.exports = alertService;
