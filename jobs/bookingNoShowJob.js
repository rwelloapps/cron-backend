const bookingCronService = require('../services/bookingCronService');
const { createJobMutex } = require('../utils/jobMutex');

const mutex = createJobMutex('bookingNoShow');

async function run() {
  await mutex.run(async () => {
    console.log('[Cron] Booking no-show job started');
    try {
      const result = await bookingCronService.processNoShows();
      console.log('[Cron] Booking no-show job done:', result.processed, 'processed');
    } catch (e) {
      console.error('[Cron] Booking no-show job error:', e);
    }
  });
}

module.exports = { run };
