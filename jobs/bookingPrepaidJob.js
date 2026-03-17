const bookingCronService = require('../services/bookingCronService');

async function run() {
  console.log('[Cron] Booking prepaid payment check started');
  try {
    const result = await bookingCronService.checkPrepaidPayments();
    console.log('[Cron] Booking prepaid check done:', result.checked, 'checked,', result.confirmed, 'confirmed');
  } catch (e) {
    console.error('[Cron] Booking prepaid job error:', e);
  }
}

module.exports = { run };
