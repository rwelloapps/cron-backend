const bookingCronService = require('../services/bookingCronService');
const { createJobMutex } = require('../utils/jobMutex');

const mutex = createJobMutex('bookingAutoComplete');

async function run() {
  await mutex.run(async () => {
    try {
      const result = await bookingCronService.autoCompleteInProgress();
      if (result.completed > 0) {
        console.log('[Cron] Auto-complete in progress:', result.completed, 'completed');
      }
    } catch (e) {
      console.error('[Cron] Booking auto-complete job error:', e);
    }
  });
}

module.exports = { run };
