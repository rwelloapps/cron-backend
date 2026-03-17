const path = require('path');
const paymentMandate = require('../../admin/models/payment_mandate');
const razorpaySdk = require(path.join(__dirname, '..', '..', 'admin', 'services', 'razorpay_sdk'));

function mapTokenStatus(razorpayData) {
  var status = (razorpayData && razorpayData.status) ? String(razorpayData.status).toLowerCase() : '';
  if (status === 'confirmed' || status === 'active') return 'confirmed';
  if (status === 'rejected' || status === 'cancelled') return 'rejected';
  if (status === 'expired') return 'expired';
  if (status === 'revoked') return 'revoked';
  if (status === 'paused') return 'paused';
  return 'pending';
}

async function checkMandate(mandate) {
  var tokenId = mandate.razorpay_token_id;
  if (!tokenId) {
    return { updated: false, status: mandate.mandate_status, error: 'No token_id' };
  }

  var result = await razorpaySdk.fetchToken(tokenId);
  if (!result.success) {
    await paymentMandate.updateOne(
      { _id: mandate._id },
      {
        $set: {
          last_error: result.error || 'Token fetch failed',
          last_error_date: new Date(),
          last_verification_date: new Date()
        },
        $inc: { verification_attempts: 1 }
      }
    );
    return { updated: false, status: mandate.mandate_status, error: result.error };
  }

  var newStatus = mapTokenStatus(result.data);
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
  mapTokenStatus: mapTokenStatus
};
