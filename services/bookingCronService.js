const path = require('path');
const mongoose = require('../services/mongo_db');
const booking = require(path.join(__dirname, '..', '..', 'admin', 'models', 'booking'));
const slotBlock = require(path.join(__dirname, '..', '..', 'admin', 'models', 'slot_block'));
const userCancellationRecord = require(path.join(__dirname, '..', '..', 'admin', 'models', 'user_cancellation_record'));
const branch = require(path.join(__dirname, '..', '..', 'admin', 'models', 'branch'));
const vendor = require(path.join(__dirname, '..', '..', 'admin', 'models', 'vendor'));
const vendorService = require(path.join(__dirname, '..', '..', 'admin', 'models', 'vendor_service'));
const premiumPlan = require(path.join(__dirname, '..', '..', 'admin', 'models', 'premium_plan'));
const cancellationPolicy = require(path.join(__dirname, '..', '..', 'admin', 'models', 'cancellation_policy'));
const razorpaySdk = require(path.join(__dirname, '..', '..', 'admin', 'services', 'razorpay_sdk'));
const { getRefundPercentage } = require(path.join(__dirname, '..', '..', 'admin', 'routes', 'v1', 'middlewares', 'cancellation_policy'));
const bookingServiceAdmin = require(path.join(__dirname, '..', '..', 'admin', 'services', 'bookingService'));
const {
  NO_SHOW_GRACE_MINUTES,
  ORDER_STATUS,
  SLOT_BLOCK_DURATION_MINUTES,
  PENDING_PAYMENT_TIMEOUT_MINUTES,
  IN_PROGRESS_AUTO_COMPLETE_MINUTES
} = require(path.join(__dirname, '..', '..', 'admin', 'constants', 'bookingConstants'));

/** Wait for MongoDB connection before running; avoids buffering timeout in cron */
async function ensureDb() {
  await mongoose.ensureConnected(25000);
}

/**
 * Check prepaid pending bookings for Razorpay payments and confirm
 */
async function checkPrepaidPayments() {
  await ensureDb();
  const pending = await booking.find({
    status: ORDER_STATUS.PENDING_PAYMENT,
    payment_type: 'prepaid',
    razorpay_order_id: { $exists: true, $ne: null }
  }).lean();

  let confirmed = 0;
  for (const b of pending) {
    try {
      const payResult = await razorpaySdk.fetchPaymentsByOrderId(b.razorpay_order_id);
      if (!payResult.success || !payResult.data?.items?.length) continue;
      const captured = payResult.data.items.find(p => p.status === 'captured');
      if (!captured) continue;

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const doc = await booking.findById(b._id).session(session);
        if (!doc || doc.payment_received) {
          await session.abortTransaction();
          continue;
        }
        doc.payment_received = true;
        doc.payment_received_at = new Date();
        doc.razorpay_payment_id = captured.id;
        doc.razorpay_amount_paise = captured.amount;
        if (captured.fee != null) doc.razorpay_commission_amount = (captured.fee || 0) / 100;
        if (captured.method) doc.razorpay_payment_method = captured.method;
        doc.status = ORDER_STATUS.CONFIRMED;
        await doc.save({ session });
        if (doc.slot_block_id) {
          await slotBlock.deleteOne({ _id: doc.slot_block_id }).session(session);
        }
        await session.commitTransaction();
        await bookingServiceAdmin.decrementRestrictionOnBookingConfirmed(doc.user_id.toString());
        confirmed++;
      } catch (e) {
        await session.abortTransaction().catch(() => {});
      } finally {
        session.endSession();
      }
    } catch (e) {
      console.error('[BookingCron] Prepaid check error for booking', b._id, e.message);
    }
  }
  return { checked: pending.length, confirmed };
}

/**
 * Expire slot blocks past expiry
 */
async function expireSlotBlocks() {
  await ensureDb();
  const result = await slotBlock.deleteMany({ expires_at: { $lt: new Date() } });
  return { deleted: result.deletedCount };
}

/**
 * No-show: orders past slot_end + grace that were not completed - cancel and refund per policy (first time only)
 */
async function processNoShows() {
  await ensureDb();
  const graceMs = NO_SHOW_GRACE_MINUTES * 60 * 1000;
  const cutoff = new Date(Date.now() - graceMs);
  const candidates = await booking.find({
    status: { $in: [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.CONFIRMED] },
    slot_end_at: { $lt: cutoff }
  }).lean();

  let processed = 0;
  for (const b of candidates) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const doc = await booking.findById(b._id).session(session);
      if (!doc || ['cancelled', 'no_show', 'completed'].includes(doc.status)) {
        await session.abortTransaction();
        continue;
      }

      doc.status = ORDER_STATUS.NO_SHOW;
      doc.is_no_show = true;
      doc.cancelled_at = new Date();
      await doc.save({ session });

      const record = new userCancellationRecord({
        user_id: doc.user_id,
        booking_id: doc._id,
        is_no_show: true,
        counts_toward_restriction: true
      });
      await record.save({ session });

      if (doc.slot_block_id) {
        await slotBlock.deleteOne({ _id: doc.slot_block_id }).session(session);
      }

      const existingNoShows = await userCancellationRecord.countDocuments({ user_id: doc.user_id, is_no_show: true, _id: { $ne: record._id } }).session(session);
      const isFirstNoShow = existingNoShows === 0;

      let refundAmount = 0;
      if (isFirstNoShow && doc.payment_received && doc.razorpay_payment_id) {
        const branchDoc = await branch.findById(doc.branch_id).lean();
        const policyDoc = branchDoc?.cancellation_policy_id ? await cancellationPolicy.findById(branchDoc.cancellation_policy_id).lean() : null;
        const hoursUntil = 0;
        const pct = policyDoc ? getRefundPercentage(policyDoc, hoursUntil) : 0;
        const amountPaid = Math.max(0, (doc.order_amount || 0) - (doc.coupon_discount_amount || 0));
        refundAmount = pct != null ? Math.round((amountPaid * pct) / 100) : 0;
        if (refundAmount > 0) {
          const refResult = await razorpaySdk.createRefund(doc.razorpay_payment_id, Math.round(refundAmount * 100) < doc.razorpay_amount_paise ? { amount: Math.round(refundAmount * 100) } : {});
          if (refResult.success) {
            doc.refund_amount = refundAmount;
            doc.refund_status = 'initiated';
            doc.razorpay_refund_id = refResult.data?.id;
            await doc.save({ session });
          }
        }
      }
      await session.commitTransaction();
      await bookingServiceAdmin.applyCancellationRestrictions(doc.user_id.toString(), true);
      processed++;
    } catch (e) {
      await session.abortTransaction().catch(() => {});
      console.error('[BookingCron] No-show error for booking', b._id, e.message);
    } finally {
      await session.endSession();
    }
  }
  return { processed };
}

/**
 * Cancel pending_payment bookings not confirmed within 30 minutes; release slot blocks
 */
async function cancelPendingPaymentTimeouts() {
  await ensureDb();
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_TIMEOUT_MINUTES * 60 * 1000);
  const candidates = await booking.find({
    status: ORDER_STATUS.PENDING_PAYMENT,
    created_at: { $lt: cutoff }
  }).lean();

  let cancelled = 0;
  for (const b of candidates) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const doc = await booking.findById(b._id).session(session);
      if (!doc || doc.status !== ORDER_STATUS.PENDING_PAYMENT) {
        await session.abortTransaction();
        continue;
      }
      doc.status = ORDER_STATUS.CANCELLED;
      doc.cancelled_at = new Date();
      doc.cancellation_reason = 'Payment not confirmed within time';
      await doc.save({ session });
      if (doc.slot_block_id) {
        await slotBlock.deleteOne({ _id: doc.slot_block_id }).session(session);
      }
      await session.commitTransaction();
      cancelled++;
    } catch (e) {
      await session.abortTransaction().catch(() => {});
      console.error('[BookingCron] Pending timeout cancel error', b._id, e.message);
    } finally {
      await session.endSession();
    }
  }
  return { cancelled };
}

/**
 * Auto-complete in_progress bookings where slot end passed 30+ min and payment received; then run settlement
 */
async function autoCompleteInProgress() {
  await ensureDb();
  const cutoff = new Date(Date.now() - IN_PROGRESS_AUTO_COMPLETE_MINUTES * 60 * 1000);
  const candidates = await booking.find({
    status: ORDER_STATUS.IN_PROGRESS,
    payment_received: true,
    slot_end_at: { $lt: cutoff }
  }).lean();

  let completed = 0;
  for (const b of candidates) {
    try {
      const doc = await booking.findById(b._id);
      if (!doc || doc.status !== ORDER_STATUS.IN_PROGRESS || !doc.payment_received) continue;
      doc.status = ORDER_STATUS.COMPLETED;
      await doc.save();
      const settle = await bookingServiceAdmin.completeBookingSettlement(doc);
      if (settle.success) completed++;
    } catch (e) {
      console.error('[BookingCron] Auto-complete error for booking', b._id, e.message);
    }
  }
  return { completed };
}

/**
 * For completed orders with payment received and wallet not yet credited: run full settlement (commission + wallet)
 */
async function processCompletedBookingsSettlement() {
  await ensureDb();
  const completed = await booking.find({
    status: ORDER_STATUS.COMPLETED,
    payment_received: true,
    wallet_credited: false
  }).lean();

  let settled = 0;
  for (const b of completed) {
    try {
      const result = await bookingServiceAdmin.completeBookingSettlement(b);
      if (result.success) settled++;
    } catch (e) {
      console.error('[BookingCron] Settlement error for booking', b._id, e.message);
    }
  }
  return { settled };
}

module.exports = {
  checkPrepaidPayments,
  expireSlotBlocks,
  processNoShows,
  cancelPendingPaymentTimeouts,
  autoCompleteInProgress,
  processCompletedBookingsSettlement
};
