const subscriptionBillingCycle = require('../../admin/models/subscription_billing_cycle');
const vendor = require('../../admin/models/vendor');
const paymentMandate = require('../../admin/models/payment_mandate');
const constants = require('../constants');
const billingAmountService = require('./billingAmountService');
const subscriptionStatusService = require('../../admin/services/subscriptionStatusService');

function getCycleForDate(subscriptionStartDate, asOfDate) {
  var start = new Date(subscriptionStartDate);
  var asOf = new Date(asOfDate);
  if (asOf < start) return null;

  var elapsedMs = asOf - start;
  var elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  var cycleIndex = Math.floor(elapsedDays / constants.BILLING_CYCLE_DAYS) + 1;
  var cycleStartDays = (cycleIndex - 1) * constants.BILLING_CYCLE_DAYS;

  var cycleStartDate = new Date(start);
  cycleStartDate.setDate(cycleStartDate.getDate() + cycleStartDays);
  var cycleEndDate = new Date(start);
  cycleEndDate.setDate(cycleEndDate.getDate() + (cycleIndex * constants.BILLING_CYCLE_DAYS));

  return {
    cycle_index: cycleIndex,
    cycle_start_date: cycleStartDate,
    cycle_end_date: cycleEndDate
  };
}

async function getOrCreateBillingCycle(vendorDoc, cycleIndex, cycleStartDate, cycleEndDate) {
  var existing = await subscriptionBillingCycle.findOne({
    vendor_id: vendorDoc._id,
    cycle_index: cycleIndex
  });
  if (existing) return existing;

  var billing = await billingAmountService.calculateBillingAmount(vendorDoc);
  var cycle = new subscriptionBillingCycle({
    vendor_id: vendorDoc._id,
    cycle_index: cycleIndex,
    cycle_start_date: cycleStartDate,
    cycle_end_date: cycleEndDate,
    amount_inr: billing.amountInr,
    branches_count: billing.branchesCount,
    plan_price: billing.planPrice,
    extra_branch_fee: billing.extraBranchFee,
    discount_amount: billing.discountAmount,
    status: 'pending'
  });
  await cycle.save();
  return cycle;
}

async function getDueCycles(asOfDate) {
  var asOf = asOfDate || new Date();
  var cycles = await subscriptionBillingCycle.find({
    status: 'pending',
    cycle_end_date: { $lte: asOf }
  })
    .populate('vendor_id')
    .sort({ cycle_end_date: 1 })
    .lean();

  var vendorIds = [];
  cycles.forEach(function (c) {
    if (c.vendor_id && c.vendor_id._id) {
      var id = c.vendor_id._id.toString();
      if (vendorIds.indexOf(id) === -1) vendorIds.push(id);
    }
  });
  var activeVendors = await vendor.find({
    _id: { $in: vendorIds },
    is_subscription_active: true,
    subscription_on_hold: { $ne: true }
  }).select('_id').lean();
  var activeSet = {};
  activeVendors.forEach(function (v) {
    activeSet[v._id.toString()] = true;
  });

  var mandates = await paymentMandate.find({ vendor_id: { $in: vendorIds } }).lean();
  var mandateByVendor = {};
  mandates.forEach(function (m) {
    mandateByVendor[m.vendor_id.toString()] = m;
  });

  return cycles
    .filter(function (c) {
      if (!c.vendor_id || !c.vendor_id._id) return false;
      return activeSet[c.vendor_id._id.toString()];
    })
    .map(function (c) {
      return {
        vendor_id: c.vendor_id,
        _id: c._id,
        cycle_index: c.cycle_index,
        amount_inr: c.amount_inr,
        mandate: c.vendor_id ? mandateByVendor[c.vendor_id._id.toString()] : null
      };
    });
}

async function ensureCurrentCycle(vendorDoc, asOfDate) {
  var start = subscriptionStatusService.getBillingSubscriptionStartDate(vendorDoc);
  if (!start) return null;
  var asOf = asOfDate || new Date();
  var cycleInfo = getCycleForDate(start, asOf);
  if (!cycleInfo) return null;
  return getOrCreateBillingCycle(
    vendorDoc,
    cycleInfo.cycle_index,
    cycleInfo.cycle_start_date,
    cycleInfo.cycle_end_date
  );
}

module.exports = {
  getCycleForDate: getCycleForDate,
  getOrCreateBillingCycle: getOrCreateBillingCycle,
  getDueCycles: getDueCycles,
  ensureCurrentCycle: ensureCurrentCycle
};
