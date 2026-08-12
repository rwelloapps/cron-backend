'use strict'

/**
 * Simple in-process mutex for cron jobs so overlapping ticks do not run twice
 * in the same process. Prefer this over nothing; multi-instance deployments
 * should still rely on atomic Mongo claims inside the job handlers.
 */
function createJobMutex(name) {
  let running = false
  return {
    async run(fn) {
      if (running) {
        console.log(`[Cron] ${name} skipped — previous run still in progress`)
        return null
      }
      running = true
      try {
        return await fn()
      } finally {
        running = false
      }
    },
  }
}

module.exports = { createJobMutex }
