const bookingCronService = require('../services/bookingCronService');

async function run() {
  try {
    const result = await bookingCronService.cancelPendingPaymentTimeouts();
    if (result.cancelled > 0) {
      console.log('[Cron] Pending payment timeout:', result.cancelled, 'cancelled');
    }
  } catch (e) {
    console.error('[Cron] Booking pending timeout job error:', e);
  }
}

module.exports = { run };
