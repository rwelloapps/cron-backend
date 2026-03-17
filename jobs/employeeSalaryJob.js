const path = require('path');
const employeeSalaryService = require(path.join(__dirname, '..', '..', 'admin', 'services', 'employeeSalaryService'));

async function run() {
  console.log("[Cron] Employee salary job started");
  try {
    var results = await employeeSalaryService.runSalaryCalculationForAll();
    console.log("[Cron] Employee salary job done, records processed:", results.length);
  } catch (e) {
    console.error("[Cron] Employee salary job error:", e);
  }
}

module.exports = { run: run };
