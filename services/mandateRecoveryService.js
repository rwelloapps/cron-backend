const vendor = require('../../admin/models/vendor');
const paymentMandate = require('../../admin/models/payment_mandate');
const subscriptionBillingCycle = require('../../admin/models/subscription_billing_cycle');
const billingCycleService = require('./billingCycleService');
const mandatePaymentService = require('./mandatePaymentService');
const subscriptionStatusService = require('../../admin/services/subscriptionStatusService');

async function getConfirmedMandateForVendor(vendorId) {
  return paymentMandate.findOne({
    vendor_id: vendorId,
    mandate_status: 'confirmed',
  }).lean();
}

async function recoverVendorPendingCycles(vendorId, source = 'unknown') {
  const out = {
    vendor_id: String(vendorId || ''),
    source,
    attempted: 0,
    paid: 0,
    failed: 0,
    activated: false,
    skipped: false,
    reason: '',
  };
  try {
    const vdoc = await vendor.findById(vendorId);
    if (!vdoc) {
      out.skipped = true;
      out.reason = 'vendor_not_found';
      return out;
    }
    if (vdoc.subscription_on_hold === true) {
      out.skipped = true;
      out.reason = 'subscription_on_hold';
      return out;
    }

    const mandate = await getConfirmedMandateForVendor(vdoc._id);
    if (!mandate) {
      out.skipped = true;
      out.reason = 'mandate_not_confirmed';
      return out;
    }

    await billingCycleService.ensureCurrentCycle(vdoc, new Date());
    const now = new Date();
    const dueCycles = await subscriptionBillingCycle
      .find({
        vendor_id: vdoc._id,
        status: { $in: ['pending', 'failed'] },
        cycle_end_date: { $lte: now },
      })
      .sort({ cycle_end_date: 1 })
      .lean();

    for (let i = 0; i < dueCycles.length; i += 1) {
      const cycle = dueCycles[i];
      out.attempted += 1;
      try {
        const payResult = await mandatePaymentService.initiateCyclePayment(cycle, mandate, vdoc.toObject());
        if (payResult.success) out.paid += 1;
        else {
          out.failed += 1;
          console.error(
            '[MandateRecovery] cycle payment failed',
            String(vdoc._id),
            cycle.cycle_index,
            payResult.error || 'unknown',
          );
        }
      } catch (e) {
        out.failed += 1;
        console.error('[MandateRecovery] cycle payment error', String(vdoc._id), cycle.cycle_index, e);
      }
    }

    const remainingDue = await subscriptionBillingCycle.countDocuments({
      vendor_id: vdoc._id,
      status: { $in: ['pending', 'failed'] },
      cycle_end_date: { $lte: new Date() },
    });

    const shouldBeActive = subscriptionStatusService.computeVendorSubscriptionActive(vdoc, null, mandate);
    const nextActive = shouldBeActive && remainingDue === 0;
    if (vdoc.is_subscription_active !== nextActive) {
      vdoc.is_subscription_active = nextActive;
      await vdoc.save();
      await subscriptionStatusService.syncBranchesSubscriptionStatus(vdoc._id, nextActive);
      out.activated = nextActive;
    }
    return out;
  } catch (e) {
    console.error('[MandateRecovery] recoverVendorPendingCycles error', String(vendorId || ''), e);
    out.skipped = true;
    out.reason = 'error';
    return out;
  }
}

async function recoverAllVendorsPendingCycles(source = 'cron-sync') {
  const mandates = await paymentMandate.find({ mandate_status: 'confirmed' }).select('vendor_id').lean();
  const ids = [...new Set(mandates.map((m) => String(m.vendor_id)).filter(Boolean))];
  const results = [];
  for (let i = 0; i < ids.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await recoverVendorPendingCycles(ids[i], source);
    results.push(r);
  }
  return {
    checked: ids.length,
    attempted: results.reduce((a, r) => a + r.attempted, 0),
    paid: results.reduce((a, r) => a + r.paid, 0),
    failed: results.reduce((a, r) => a + r.failed, 0),
    activated: results.filter((r) => r.activated).length,
  };
}

module.exports = {
  recoverVendorPendingCycles,
  recoverAllVendorsPendingCycles,
};

