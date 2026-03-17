const path = require('path');
const subscriptionBillingCycle = require('../../admin/models/subscription_billing_cycle');
const wallet = require('../../admin/models/wallet');
const walletTransaction = require('../../admin/models/wallet_transaction');
const constants = require('../constants');
const razorpaySdk = require(path.join(__dirname, '..', '..', 'admin', 'services', 'razorpay_sdk'));

async function initiateCyclePayment(cycleDoc, mandate, vendor) {
  if (mandate.mandate_status !== constants.MANDATE_CONFIRMED_STATUS) {
    return { success: false, error: 'Mandate not confirmed: ' + mandate.mandate_status };
  }

  var amountPaise = Math.round(Number(cycleDoc.amount_inr) * 100);
  if (amountPaise < 100) {
    await subscriptionBillingCycle.updateOne(
      { _id: cycleDoc._id },
      { $set: { status: 'paid', paid_at: new Date(), notes: 'Zero amount - auto marked paid' } }
    );
    return { success: true, paymentId: null };
  }

  var vendorId = cycleDoc.vendor_id && cycleDoc.vendor_id._id ? cycleDoc.vendor_id._id : cycleDoc.vendor_id;
  var receipt = 'sub_cycle_' + vendorId + '_' + cycleDoc.cycle_index + '_' + Date.now();
  var result = await razorpaySdk.createRecurringPayment({
    customer_id: mandate.razorpay_customer_id,
    token_id: mandate.razorpay_token_id,
    amount: amountPaise,
    currency: 'INR',
    receipt: receipt,
    notes: {
      vendor_id: String(vendorId),
      cycle_index: String(cycleDoc.cycle_index),
      cycle_id: String(cycleDoc._id)
    }
  });

  if (!result.success) {
    await subscriptionBillingCycle.updateOne(
      { _id: cycleDoc._id },
      {
        $set: {
          status: 'failed',
          failure_reason: result.error || 'Recurring payment failed',
          updated_at: new Date()
        }
      }
    );
    return { success: false, error: result.error };
  }

  var paymentId = result.data && result.data.id ? result.data.id : null;
  var orderId = result.data && result.data.order_id ? result.data.order_id : null;

  await subscriptionBillingCycle.updateOne(
    { _id: cycleDoc._id },
    {
      $set: {
        status: 'paid',
        razorpay_payment_id: paymentId,
        razorpay_order_id: orderId,
        paid_at: new Date(),
        updated_at: new Date()
      }
    }
  );

  var walletDoc = await wallet.findOne({ vendor_id: vendorId }).lean();
  if (walletDoc) {
    var balanceBefore = Number(walletDoc.balance) || 0;
    var amount = Number(cycleDoc.amount_inr) || 0;
    var balanceAfter = balanceBefore - amount;
    await walletTransaction.create({
      wallet_id: walletDoc._id,
      transaction_type: 'debit',
      amount: amount,
      balance_before: balanceBefore,
      balance_after: Math.max(0, balanceAfter),
      currency: 'INR',
      transaction_category: 'subscription_payment',
      description: 'Subscription cycle ' + cycleDoc.cycle_index + ' (mandate)',
      reference_id: String(cycleDoc._id),
      reference_type: 'subscription',
      payment_method: 'razorpay',
      payment_id: paymentId,
      status: 'completed'
    });
    await wallet.updateOne(
      { _id: walletDoc._id },
      { $set: { balance: Math.max(0, balanceAfter), updated_at: new Date() } }
    );
  }

  return { success: true, paymentId: paymentId };
}

module.exports = {
  initiateCyclePayment: initiateCyclePayment
};
