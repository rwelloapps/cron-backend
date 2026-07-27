'use strict';

const http = require('http');
const os = require('os');
const mongoose = require('./services/mongo_db');
const { version } = require('./package.json');

const PORT = Number(process.env.CRON_HEALTH_PORT || process.env.PORT_CRON_HEALTH || 2030);

function startHealthServer() {
  const server = http.createServer(async (req, res) => {
    const path = String(req.url || '').split('?')[0];
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && (path === '/health' || path === '/api/health' || path === '/')) {
      const started = Date.now();
      let database = 'Disconnected';
      let databaseCode = 500;
      try {
        await mongoose.ensureConnected(8000);
        if (mongoose.connection.readyState === 1) {
          database = 'Connected';
          databaseCode = 200;
        } else {
          database = `State ${mongoose.connection.readyState}`;
        }
      } catch (error) {
        database = error?.message || 'Connection failed';
      }

      const ok = databaseCode === 200;
      const body = {
        response_code: ok ? 200 : 500,
        message: ok ? 'OK' : 'Unhealthy',
        response: {
          service: 'rwello-cron',
          database,
          database_code: databaseCode,
          cache_database: 'Not used',
          cache_database_code: 200,
          version,
          hostname: os.hostname(),
          response_time_ms: Date.now() - started,
        },
      };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(body));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ response_code: 404, message: 'Not found', response: null }));
  });

  server.listen(PORT, () => {
    console.log(`[Cron] Health endpoint listening on :${PORT} (GET /health)`);
  });

  server.on('error', (error) => {
    console.error('[Cron] Health server error:', error.message);
  });

  return server;
}

module.exports = { startHealthServer, PORT };
