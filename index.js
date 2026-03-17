require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
process.env.TZ = 'Asia/Calcutta';

const cron = require('node-cron');
const mongoose = require('./services/mongo_db');

const mandateCheckJob = require('./jobs/mandateCheckJob');
const subscriptionHoldJob = require('./jobs/subscriptionHoldJob');
const billingCycleJob = require('./jobs/billingCycleJob');
const employeeSalaryJob = require('./jobs/employeeSalaryJob');
const subscriptionStatusSyncJob = require('./jobs/subscriptionStatusSyncJob');
const bookingPrepaidJob = require('./jobs/bookingPrepaidJob');
const bookingNoShowJob = require('./jobs/bookingNoShowJob');
const bookingSlotBlockJob = require('./jobs/bookingSlotBlockJob');
const bookingPendingTimeoutJob = require('./jobs/bookingPendingTimeoutJob');
const bookingAutoCompleteJob = require('./jobs/bookingAutoCompleteJob');
const bookingSettlementJob = require('./jobs/bookingSettlementJob');

function startScheduler() {
  cron.schedule('0 2 * * *', function () {
    mandateCheckJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('0 3 * * *', function () {
    subscriptionHoldJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('0 4 * * *', function () {
    billingCycleJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('0 5 * * *', function () {
    employeeSalaryJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('0 * * * *', function () {
    subscriptionStatusSyncJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('* * * * *', function () {
    bookingPrepaidJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('* * * * *', function () {
    bookingSlotBlockJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('*/5 * * * *', function () {
    bookingNoShowJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('* * * * *', function () {
    bookingPendingTimeoutJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('* * * * *', function () {
    bookingAutoCompleteJob.run();
  }, { timezone: 'Asia/Kolkata' });

  cron.schedule('*/5 * * * *', function () {
    bookingSettlementJob.run();
  }, { timezone: 'Asia/Kolkata' });

  console.log("[Cron] Scheduler started (mandate 02:00, hold 03:00, billing 04:00, employee salary 05:00, subscription sync hourly, prepaid+slot-block every min, no-show every 5min, pending-timeout+autocomplete every min, settlement every 5min IST)");
}

(async function () {
  try {
    await mongoose.connectionReady;
    console.log("[Cron] MongoDB ready, starting scheduler");
    startScheduler();
  } catch (e) {
    console.error("[Cron] Failed to wait for MongoDB:", e);
    process.exit(1);
  }
})();
