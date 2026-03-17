const path = require('path');

// Use the same mongoose instance that admin models use (booking, slot_block, etc.).
// Otherwise cron would connect cron's mongoose while models use admin's → buffering timeout.
const mongoose = require(path.join(__dirname, '..', '..', 'admin', 'lib', 'cronMongoose'));

let connectionReadyResolve;
const connectionReady = new Promise(function (resolve) {
  connectionReadyResolve = resolve;
});

// Match admin service options so connection works the same way
const CONNECT_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 150
};

// Longer buffer timeout so reconnects don't throw "buffering timed out" (default 10s)
mongoose.set('bufferTimeoutMS', 30000);

const mongo_connector = async function (mongoose) {
  const uri = process.env.MONGODB_URL;
  if (!uri || typeof uri !== 'string' || !uri.trim()) {
    throw new Error('MONGODB_URL is not set. Cron loads .env from parent directory (Rwello Backend).');
  }
  await mongoose.connect(uri, CONNECT_OPTIONS)
    .then(function () {
      console.log("MongoDB Connected");
      return (false);
    }).catch(function (e) {
      throw e;
    });
};

async function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

const mongo_init = async function (mongoose) {
  var con_flag = true;
  var wait_time = 1000;

  while (con_flag) {
    await mongo_connector(mongoose)
      .then(function () {
        con_flag = false;
        if (connectionReadyResolve) connectionReadyResolve();
      }).catch(async function (e) {
        console.log(e);
        console.log("Retrying MongoDB Connection in " + (wait_time / 1000) + "s...");
        await sleep(wait_time);
        wait_time += 1000;
        con_flag = true;
      });
  }
};

process.on('SIGINT', function () {
  mongoose.connection.close(function () {
    console.log('MongoDb disconnected on app termination');
    process.exit(0);
  });
});

/**
 * Wait for connection to be ready before running DB operations.
 * Use at the start of cron jobs to avoid "buffering timed out" when connection is slow or dropped.
 */
function ensureConnected(timeoutMs = 25000) {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      mongoose.connection.removeListener('connected', onConnect);
      reject(new Error('MongoDB connection timeout; skipping job'));
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(t);
      resolve();
    };
    mongoose.connection.once('connected', onConnect);
  });
}

mongo_init(mongoose);
mongoose.mongo_init = mongo_init;
mongoose.connectionReady = connectionReady;
mongoose.ensureConnected = ensureConnected;
module.exports = mongoose;
