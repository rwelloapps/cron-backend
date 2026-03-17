const subscriptionBillingCycle = require('../../admin/models/subscription_billing_cycle');
const paymentMandate = require('../../admin/models/payment_mandate');
const vendor = require('../../admin/models/vendor');
const subscriptionLog = require('../../admin/models/subscription_log');
const constants = require('../constants');
const subscriptionStatusService = require('../../admin/services/subscriptionStatusService');

async function applyHoldForPendingMandateFailures(asOfDate) {
  var asOf = asOfDate || new Date();
  var cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() - constants.PENDING_HOLD_DAYS);

  var pendingCycles = await subscriptionBillingCycle.find({
    status: 'pending',
    cycle_end_date: { $lte: cutoff }
  })
    .select('vendor_id')
    .lean();

  var vendorIds = [];
  pendingCycles.forEach(function (c) {
    var id = c.vendor_id.toString();
    if (vendorIds.indexOf(id) === -1) vendorIds.push(id);
  });

  var vendorIdsWithInvalidMandate = {};
  if (vendorIds.length > 0) {
    var invalidMandates = await paymentMandate.find({
      vendor_id: { $in: vendorIds },
      mandate_status: { $in: constants.MANDATE_INVALID_STATUSES }
    })
      .select('vendor_id')
      .lean();
    invalidMandates.forEach(function (m) {
      vendorIdsWithInvalidMandate[m.vendor_id.toString()] = true;
    });
  }
  var toHoldFromPending = vendorIds.filter(function (id) {
    return vendorIdsWithInvalidMandate[id];
  });

  var pastDueCounts = await subscriptionBillingCycle.aggregate([
    {
      $match: {
        status: { $in: ['pending', 'failed'] },
        cycle_end_date: { $lt: asOf }
      }
    },
    { $group: { _id: '$vendor_id', count: { $sum: 1 } } },
    { $match: { count: { $gte: constants.FAILED_CYCLES_FOR_HOLD } } }
  ]);
  var toHoldFromFailedCycles = pastDueCounts.map(function (r) {
    return r._id.toString();
  });

  var toHoldSet = {};
  toHoldFromPending.forEach(function (id) {
    toHoldSet[id] = true;
  });
  toHoldFromFailedCycles.forEach(function (id) {
    toHoldSet[id] = true;
  });
  var toHold = Object.keys(toHoldSet);

  var putOnHold = [];
  for (var i = 0; i < toHold.length; i++) {
    var vid = toHold[i];
    var vendorDoc = await vendor.findById(vid);
    if (!vendorDoc || vendorDoc.subscription_on_hold) continue;

    vendorDoc.subscription_on_hold = true;
    vendorDoc.subscription_hold_date = new Date();
    vendorDoc.is_subscription_active = false;
    await vendorDoc.save();
    await subscriptionStatusService.syncBranchesSubscriptionStatus(vendorDoc._id, false);
    putOnHold.push(vid);

    try {
      await subscriptionLog.create({
        vendor_id: vendorDoc._id,
        new_plan_id: vendorDoc.premium_plan_id,
        change_type: 'hold',
        change_date: new Date(),
        subscription_start_date: vendorDoc.subscription_start_date,
        subscription_end_date: vendorDoc.subscription_end_date,
        subscription_on_hold: true,
        subscription_hold_date: vendorDoc.subscription_hold_date,
        branches_at_change: vendorDoc.total_branches_created || 0,
        old_subscription_on_hold: false,
        notes: 'Auto hold: payment failed >= 2 months or mandate invalid with pending > 60 days'
      });
    } catch (err) {
      // continue
    }
  }
  return { putOnHold: putOnHold };
}

module.exports = {
  applyHoldForPendingMandateFailures: applyHoldForPendingMandateFailures
};
