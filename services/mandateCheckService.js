const path = require('path');
const paymentMandate = require('../../admin/models/payment_mandate');
const vendor = require('../../admin/models/vendor');
const easebuzzSdk = require(path.join(__dirname, '..', '..', 'admin', 'services', 'easebuzz_sdk'));

function mapPaymentStatus(payData) {
  if (!payData) return 'pending';
  var st = String(payData.status || '').toLowerCase();
  if (st === 'captured' || st === 'success' || st === 'authorized') return 'confirmed';
  return 'pending';
}

async function checkMandate(mandate) {
  if (!mandate.razorpay_payment_id || !mandate.razorpay_order_id) {
    return { updated: false, status: mandate.mandate_status, error: 'Missing easepayid/txnid on mandate for Easebuzz verification' };
  }

  var vdoc = await vendor.findById(mandate.vendor_id).lean();
  var result = await easebuzzSdk.fetchPayment(mandate.razorpay_payment_id, {
    razorpay_order_id: mandate.razorpay_order_id,
    pg_pay_email: vdoc && vdoc.email,
    pg_pay_phone: (vdoc && (vdoc.phone || vdoc.temp_phone)) || undefined,
    razorpay_amount_paise: mandate.mandate_amount != null
      ? Math.max(100, Math.round(Number(mandate.mandate_amount) * 100))
      : 100
  });

  if (!result.success) {
    await paymentMandate.updateOne(
      { _id: mandate._id },
      {
        $set: {
          last_error: result.error || 'Payment retrieve failed',
          last_error_date: new Date(),
          last_verification_date: new Date()
        },
        $inc: { verification_attempts: 1 }
      }
    );
    return { updated: false, status: mandate.mandate_status, error: result.error };
  }

  var newStatus = mapPaymentStatus(result.data);
  await paymentMandate.updateOne(
    { _id: mandate._id },
    {
      $set: {
        mandate_status: newStatus,
        last_verification_date: new Date(),
        last_error: null,
        last_error_date: null
      },
      $inc: { verification_attempts: 1 }
    }
  );
  return { updated: true, status: newStatus };
}

async function checkAllMandates() {
  var mandates = await paymentMandate.find({
    mandate_status: { $in: ['pending', 'confirmed'] }
  }).lean();

  var updated = 0;
  var errors = [];
  for (var i = 0; i < mandates.length; i++) {
    var m = mandates[i];
    try {
      var out = await checkMandate(m);
      if (out.updated) updated++;
      if (out.error) errors.push('Vendor ' + m.vendor_id + ': ' + out.error);
    } catch (e) {
      errors.push('Vendor ' + m.vendor_id + ': ' + e.message);
    }
  }
  return { checked: mandates.length, updated: updated, errors: errors };
}

module.exports = {
  checkMandate: checkMandate,
  checkAllMandates: checkAllMandates,
  mapPaymentStatus: mapPaymentStatus
};
