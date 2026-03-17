const subscriptionHoldService = require('../services/subscriptionHoldService');

async function run() {
  console.log("[Cron] Subscription hold job started");
  try {
    var result = await subscriptionHoldService.applyHoldForPendingMandateFailures();
    if (result.putOnHold.length) {
      console.log("[Cron] Subscriptions put on hold:", result.putOnHold);
    } else {
      console.log("[Cron] Subscription hold check done, none to hold");
    }
  } catch (e) {
    console.error("[Cron] Subscription hold job error:", e);
  }
}

module.exports = { run: run };
