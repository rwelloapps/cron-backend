const path = require('path');
const mongoose = require('../services/mongo_db');
const booking = require(path.join(__dirname, '..', '..', 'admin', 'models', 'booking'));
const userModel = require(path.join(__dirname, '..', '..', 'admin', 'models', 'user'));
const slotBlock = require(path.join(__dirname, '..', '..', 'admin', 'models', 'slot_block'));
const userCancellationRecord = require(path.join(__dirname, '..', '..', 'admin', 'models', 'user_cancellation_record'));
const branch = require(path.join(__dirname, '..', '..', 'admin', 'models', 'branch'));
const vendor = require(path.join(__dirname, '..', '..', 'admin', 'models', 'vendor'));
const vendorService = require(path.join(__dirname, '..', '..', 'admin', 'models', 'vendor_service'));
const premiumPlan = require(path.join(__dirname, '..', '..', 'admin', 'models', 'premium_plan'));
const cancellationPolicy = require(path.join(__dirname, '..', '..', 'admin', 'models', 'cancellation_policy'));
const easebuzzSdk = require(path.join(__dirname, '..', '..', 'admin', 'services', 'easebuzz_sdk'));
const { getRefundPercentage } = require(path.join(__dirname, '..', '..', 'admin', 'routes', 'v1', 'middlewares', 'cancellation_policy'));
const bookingServiceAdmin = require(path.join(__dirname, '..', '..', 'admin', 'services', 'bookingService'));
const { notifyBookingCancelled, notifyBookingNoShow } = require(path.join(__dirname, '..', '..', 'admin', 'services', 'notificationService'));
const { roundMoney, totalCustomerPaysFromBooking } = bookingServiceAdmin;
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
 * Check prepaid pending bookings for Easebuzz payments and confirm
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
      const payResult = await easebuzzSdk.fetchPaymentsByOrderId(b.razorpay_order_id, b);
      if (!payResult.success || !payResult.data) continue;
      const st = payResult.data.status;
      if (st !== 'captured' && st !== 'success') continue;
      const captured = payResult.data;

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const doc = await booking.findById(b._id).session(session);
        if (!doc || doc.payment_received) {
          await session.abortTransaction();
          continue;
        }
        const endUser = await userModel.findById(doc.user_id).select('is_blocked').session(session).lean();
        if (endUser?.is_blocked) {
          await session.abortTransaction();
          continue;
        }
        doc.payment_received = true;
        doc.payment_received_at = new Date();
        doc.razorpay_payment_id = captured.easepayid || captured.id;
        doc.razorpay_amount_paise = captured.amount;
        const pgPct = doc.pg_commission_percentage || 0;
        if (pgPct > 0) {
          const totalIn = totalCustomerPaysFromBooking(doc);
          doc.razorpay_commission_amount = roundMoney((totalIn * pgPct) / 100);
        } else if (captured.fee != null) {
          doc.razorpay_commission_amount = (captured.fee || 0) / 100;
        }
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
  const result = await slotBlock.deleteMany({
    expires_at: { $lt: new Date() },
    $or: [{ booking_id: { $exists: false } }, { booking_id: null }],
  });
  return { deleted: result.deletedCount };
}

/** Slot ended long enough ago to run post-slot actions (no-show / pending cancel). */
function slotEndCutoff(now = new Date()) {
  const graceMs = Math.max(0, Number(NO_SHOW_GRACE_MINUTES) || 0) * 60 * 1000;
  return new Date(now.getTime() - graceMs);
}

async function releaseSlotBlock(session, slotBlockId) {
  if (!slotBlockId) return;
  await slotBlock.deleteOne({ _id: slotBlockId }).session(session);
}

/**
 * Cancel pending bookings whose scheduled slot has ended (vendor never confirmed / payment never completed).
 */
async function processExpiredPendingBookings() {
  await ensureDb();
  const cutoff = slotEndCutoff();
  const candidates = await booking.find({
    status: { $in: [ORDER_STATUS.PENDING_CONFIRMATION, ORDER_STATUS.PENDING_PAYMENT] },
    slot_end_at: { $lt: cutoff },
  }).lean();

  let cancelled = 0;
  for (const b of candidates) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const doc = await booking.findById(b._id).session(session);
      if (!doc) {
        await session.abortTransaction();
        continue;
      }
      const priorStatus = doc.status;
      if (![ORDER_STATUS.PENDING_CONFIRMATION, ORDER_STATUS.PENDING_PAYMENT].includes(priorStatus)) {
        await session.abortTransaction();
        continue;
      }
      if (!doc.slot_end_at || new Date(doc.slot_end_at) >= cutoff) {
        await session.abortTransaction();
        continue;
      }
      if (priorStatus === ORDER_STATUS.PENDING_PAYMENT && doc.payment_received === true) {
        await session.abortTransaction();
        continue;
      }

      doc.status = ORDER_STATUS.CANCELLED;
      doc.cancelled_at = new Date();
      doc.cancellation_reason =
        priorStatus === ORDER_STATUS.PENDING_CONFIRMATION
          ? 'Not confirmed before appointment ended'
          : 'Payment not completed before appointment ended';
      await doc.save({ session });
      await releaseSlotBlock(session, doc.slot_block_id);
      await session.commitTransaction();
      notifyBookingCancelled({
        booking: doc.toObject ? doc.toObject() : doc,
        initiatedBy: 'system',
      }).catch((err) => console.error('[BookingCron] expired pending cancel notification', err));
      cancelled++;
    } catch (e) {
      await session.abortTransaction().catch(() => {});
      console.error('[BookingCron] Expired pending cancel error for booking', b._id, e.message);
    } finally {
      session.endSession();
    }
  }
  return { cancelled };
}

/**
 * No-show: confirmed bookings past slot end that never started (OTP not entered).
 */
async function processNoShows() {
  await ensureDb();
  const cutoff = slotEndCutoff();
  const candidates = await booking.find({
    status: ORDER_STATUS.CONFIRMED,
    slot_end_at: { $lt: cutoff },
    $or: [{ service_started_at: null }, { service_started_at: { $exists: false } }],
  }).lean();

  let processed = 0;
  for (const b of candidates) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const doc = await booking.findById(b._id).session(session);
      if (!doc || doc.status !== ORDER_STATUS.CONFIRMED) {
        await session.abortTransaction();
        continue;
      }
      if (doc.service_started_at) {
        await session.abortTransaction();
        continue;
      }
      if (!doc.slot_end_at || new Date(doc.slot_end_at) >= cutoff) {
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

      await releaseSlotBlock(session, doc.slot_block_id);

      const existingNoShows = await userCancellationRecord.countDocuments({ user_id: doc.user_id, is_no_show: true, _id: { $ne: record._id } }).session(session);
      const isFirstNoShow = existingNoShows === 0;

      let refundAmount = 0;
      if (isFirstNoShow && doc.payment_received && doc.razorpay_payment_id) {
        const branchDoc = await branch.findById(doc.branch_id).lean();
        const policyDoc = branchDoc?.cancellation_policy_id ? await cancellationPolicy.findById(branchDoc.cancellation_policy_id).lean() : null;
        const hoursUntil = 0;
        const pct = policyDoc ? getRefundPercentage(policyDoc, hoursUntil) : 0;
        const totalPaid = totalCustomerPaysFromBooking(doc);
        refundAmount = pct != null ? roundMoney((totalPaid * pct) / 100) : 0;
        if (refundAmount > 0) {
          const refResult = await easebuzzSdk.createRefund(
            doc.razorpay_payment_id,
            Math.round(refundAmount * 100) < doc.razorpay_amount_paise ? { amount: Math.round(refundAmount * 100) } : {},
            doc
          );
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
      notifyBookingNoShow({
        booking: doc.toObject ? doc.toObject() : doc,
        initiatedBy: 'system',
      }).catch((err) => console.error('[BookingCron] no-show notification', err));
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
      if (!doc || doc.status !== ORDER_STATUS.PENDING_PAYMENT || doc.payment_received === true) {
        await session.abortTransaction();
        continue;
      }
      doc.status = ORDER_STATUS.CANCELLED;
      doc.cancelled_at = new Date();
      doc.cancellation_reason = 'Payment not confirmed within time';
      await doc.save({ session });
      await releaseSlotBlock(session, doc.slot_block_id);
      await session.commitTransaction();
      notifyBookingCancelled({
        booking: doc.toObject ? doc.toObject() : doc,
        initiatedBy: 'system',
      }).catch((err) => console.error('[BookingCron] pending payment timeout notification', err));
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
 * Auto-complete in_progress bookings 1 hour after scheduled slot end if not manually completed.
 */
async function autoCompleteInProgress() {
  await ensureDb();
  const cutoff = new Date(Date.now() - IN_PROGRESS_AUTO_COMPLETE_MINUTES * 60 * 1000);
  const candidates = await booking.find({
    status: ORDER_STATUS.IN_PROGRESS,
    slot_end_at: { $lt: cutoff },
  }).lean();

  let completed = 0;
  for (const b of candidates) {
    try {
      const doc = await booking.findById(b._id);
      if (!doc || doc.status !== ORDER_STATUS.IN_PROGRESS) continue;
      if (!doc.slot_end_at || new Date(doc.slot_end_at) >= cutoff) continue;
      doc.status = ORDER_STATUS.COMPLETED;
      if (!doc.service_completed_at) doc.service_completed_at = new Date();
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
    status: { $in: [ORDER_STATUS.COMPLETED, ORDER_STATUS.NO_SHOW, ORDER_STATUS.CANCELLED] },
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
  processExpiredPendingBookings,
  processNoShows,
  cancelPendingPaymentTimeouts,
  autoCompleteInProgress,
  processCompletedBookingsSettlement
};
