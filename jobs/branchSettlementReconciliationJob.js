const path = require('path');
const mongoose = require('../services/mongo_db');
const settlementService = require(path.join(
  __dirname,
  '..',
  '..',
  'admin',
  'services',
  'branchSettlementService.js',
));

let running = false;

async function run() {
  if (running) return;
  running = true;
  try {
    await mongoose.ensureConnected();
    const result = await settlementService.reconcilePendingSettlements(100);
    if (result.checked || result.errors) {
      console.log(
        '[Cron] Branch settlements:',
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
    console.error('[Cron] Branch settlement reconciliation error:', error);
  } finally {
    running = false;
  }
}

module.exports = { run };
