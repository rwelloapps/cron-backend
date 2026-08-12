const bookingCronService = require('../services/bookingCronService');
const { createJobMutex } = require('../utils/jobMutex');

const mutex = createJobMutex('bookingPrepaid');

async function run() {
  await mutex.run(async () => {
    console.log('[Cron] Booking prepaid payment check started');
    try {
      const result = await bookingCronService.checkPrepaidPayments();
      console.log('[Cron] Booking prepaid check done:', result.checked, 'checked,', result.confirmed, 'confirmed');
    } catch (e) {
      console.error('[Cron] Booking prepaid job error:', e);
    }
  });
}

module.exports = { run };
