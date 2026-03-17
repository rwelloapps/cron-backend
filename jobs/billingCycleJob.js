const vendor = require('../../admin/models/vendor');
const billingCycleService = require('../services/billingCycleService');
const mandatePaymentService = require('../services/mandatePaymentService');
const subscriptionStatusService = require('../../admin/services/subscriptionStatusService');

async function run() {
  console.log("[Cron] Billing cycle job started");
  try {
    await subscriptionStatusService.refreshAllVendorsSubscriptionStatus();

    var activeVendors = await vendor.find({
      is_subscription_active: true,
      subscription_on_hold: { $ne: true },
      premium_plan_id: { $exists: true, $ne: null }
    }).lean();
    for (var i = 0; i < activeVendors.length; i++) {
      await billingCycleService.ensureCurrentCycle(activeVendors[i]);
    }
    var dueCycles = await billingCycleService.getDueCycles();
    console.log("[Cron] Due cycles:", dueCycles.length);

    for (var j = 0; j < dueCycles.length; j++) {
      var row = dueCycles[j];
      var cycle = row;
      var mandate = row.mandate;
      var vendorDoc = row.vendor_id;

      if (!mandate) {
        console.log("[Cron] Skip cycle (no mandate):", cycle.vendor_id, cycle.cycle_index);
        continue;
      }

      var payResult = await mandatePaymentService.initiateCyclePayment(cycle, mandate, vendorDoc);
      if (payResult.success) {
        console.log("[Cron] Cycle paid:", cycle.vendor_id, cycle.cycle_index, payResult.paymentId || "zero");
      } else {
        console.log("[Cron] Cycle payment failed:", cycle.vendor_id, cycle.cycle_index, payResult.error);
      }
    }
  } catch (e) {
    console.error("[Cron] Billing cycle job error:", e);
  }
}

module.exports = { run: run };
