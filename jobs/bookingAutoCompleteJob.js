const bookingCronService = require('../services/bookingCronService');

async function run() {
  try {
    const result = await bookingCronService.autoCompleteInProgress();
    if (result.completed > 0) {
      console.log('[Cron] Auto-complete in progress:', result.completed, 'completed');
    }
  } catch (e) {
    console.error('[Cron] Booking auto-complete job error:', e);
  }
}

module.exports = { run };
