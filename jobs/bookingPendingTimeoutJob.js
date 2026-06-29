const bookingCronService = require('../services/bookingCronService');

async function run() {
  try {
    const [timeoutResult, expiredResult] = await Promise.all([
      bookingCronService.cancelPendingPaymentTimeouts(),
      bookingCronService.processExpiredPendingBookings(),
    ]);
    if (timeoutResult.cancelled > 0) {
      console.log('[Cron] Pending payment timeout:', timeoutResult.cancelled, 'cancelled');
    }
    if (expiredResult.cancelled > 0) {
      console.log('[Cron] Expired pending bookings:', expiredResult.cancelled, 'cancelled');
    }
  } catch (e) {
    console.error('[Cron] Booking pending timeout job error:', e);
  }
}

module.exports = { run };
