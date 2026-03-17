const bookingCronService = require('../services/bookingCronService');

async function run() {
  console.log('[Cron] Slot block expiry job started');
  try {
    const result = await bookingCronService.expireSlotBlocks();
    if (result.deleted > 0) {
      console.log('[Cron] Slot block expiry done:', result.deleted, 'deleted');
    }
  } catch (e) {
    console.error('[Cron] Slot block expiry job error:', e);
  }
}

module.exports = { run };
