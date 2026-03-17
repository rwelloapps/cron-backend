const mandateCheckService = require('../services/mandateCheckService');

async function run() {
  console.log("[Cron] Mandate check job started");
  try {
    var result = await mandateCheckService.checkAllMandates();
    console.log("[Cron] Mandate check done:", result.checked, "checked,", result.updated, "updated");
    if (result.errors.length) console.log("[Cron] Mandate errors:", result.errors);
  } catch (e) {
    console.error("[Cron] Mandate check job error:", e);
  }
}

module.exports = { run: run };
