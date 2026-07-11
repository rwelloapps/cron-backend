const path = require('path')
const mongoose = require('../services/mongo_db')
const notificationReminderService = require(path.join(__dirname, '..', '..', 'admin', 'services', 'notificationReminderService'))

async function run() {
  console.log('[Cron] Booking notification reminders job started')
  try {
    await mongoose.ensureConnected(25000)
    const stats = await notificationReminderService.processBookingReminders()
    console.log('[Cron] Booking notification reminders done:', stats)
  } catch (e) {
    console.error('[Cron] Booking notification reminders error:', e)
  }
}

module.exports = { run }
