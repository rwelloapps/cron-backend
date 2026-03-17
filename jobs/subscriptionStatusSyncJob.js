/**
 * Re-verify mandate status with Razorpay and refresh vendor/branch is_subscription_active.
 * Runs frequently (e.g. hourly) so that if a check fails during the day, status is updated
 * without waiting for the next day's billing/hold jobs.
 */
const mandateCheckService = require('../services/mandateCheckService');
const subscriptionStatusService = require('../../admin/services/subscriptionStatusService');
const paymentMandate = require('../../admin/models/payment_mandate');

async function run() {
  console.log("[Cron] Subscription status sync job started");
  try {
    var mandateResult = await mandateCheckService.checkAllMandates();
    console.log("[Cron] Mandate check:", mandateResult.checked, "checked,", mandateResult.updated, "updated");
    if (mandateResult.errors.length) {
      console.log("[Cron] Mandate errors:", mandateResult.errors);
    }

    var refreshResult = await subscriptionStatusService.refreshAllVendorsSubscriptionStatusWithMandateCheck(paymentMandate);
    console.log("[Cron] Subscription status sync done:", refreshResult.refreshed, "vendors refreshed");
  } catch (e) {
    console.error("[Cron] Subscription status sync job error:", e);
  }
}

module.exports = { run: run };
