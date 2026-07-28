const path = require('path');
const mongoose = require('../services/mongo_db');
const manualPaymentService = require(path.join(
  __dirname,
  '..',
  '..',
  'admin',
  'services',
  'branchManualPaymentService.js',
));

let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    await mongoose.ensureConnected();
    const result = await manualPaymentService.reconcilePendingManualPayments(100);
    if (result.checked || result.errors) {
      console.log(
        '[Cron] Branch manual payments:',
        result.checked,
        'checked,',
        result.completed,
        'completed,',
        result.failed,
        'failed,',
        result.errors,
        'errors',
      );
    }
  } catch (error) {
    console.error('[Cron] Branch manual payment reconciliation error:', error);
  } finally {
    running = false;
  }
}

module.exports = { run };
