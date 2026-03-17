const bookingCronService = require('../services/bookingCronService');

async function run() {
  console.log('[Cron] Booking no-show job started');
  try {
    const result = await bookingCronService.processNoShows();
    console.log('[Cron] Booking no-show job done:', result.processed, 'processed');
  } catch (e) {
    console.error('[Cron] Booking no-show job error:', e);
  }
}

module.exports = { run };
