const bookingCronService = require('../services/bookingCronService');

async function run() {
  try {
    const result = await bookingCronService.processCompletedBookingsSettlement();
    if (result.settled > 0) {
      console.log('[Cron] Booking settlement:', result.settled, 'settled (wallet credited)');
    }
  } catch (e) {
    console.error('[Cron] Booking settlement job error:', e);
  }
}

module.exports = { run };
