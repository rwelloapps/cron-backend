const path = require('path')
const mongoose = require('../services/mongo_db')
const userArchiveService = require(path.join(
  __dirname,
  '..',
  '..',
  'admin',
  'services',
  'userArchiveService.js',
))

async function run() {
  console.log('[Cron] Inactive customer archive job started')
  try {
    await mongoose.ensureConnected()
    const result = await userArchiveService.archiveInactiveUsers({ limit: 100 })
    console.log(
      '[Cron] Inactive customer archive job done:',
      result.archived,
      'archived,',
      result.skipped,
      'skipped',
    )
    if (result.errors.length) {
      console.error('[Cron] Inactive customer archive errors:', result.errors)
    }
  } catch (error) {
    console.error('[Cron] Inactive customer archive job error:', error)
  }
}

module.exports = { run }
