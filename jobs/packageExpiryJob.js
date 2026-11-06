const path = require('path')
const mongoose = require('../services/mongo_db')
const packageService = require(path.join(__dirname, '..', '..', 'admin', 'services', 'packageService'))

async function run() {
  console.log('[Cron] Package expiry job started')
  try {
    await mongoose.ensureConnected()
    const count = await packageService.expireDue()
    console.log('[Cron] Package expiry job done:', count, 'expired')
  } catch (err) {
    console.error('[Cron] Package expiry job failed', err)
  }
}

module.exports = { run }
