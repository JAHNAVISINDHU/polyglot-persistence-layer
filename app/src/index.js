require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const postgres = require('./databases/postgres');
const mongo = require('./databases/mongo');
const neo4j = require('./databases/neo4j');
const { ingestLogFile } = require('./ingestion/logProcessor');
const { runReconciliation } = require('./reconciliation/reconciler');
const routes = require('./api/routes');

const app = express();
const PORT = process.env.APP_PORT || 3000;

app.use(express.json());

// Mount all routes under /query and root
app.use('/query', routes);
app.get('/', (req, res) => res.json({ service: 'logistics-platform', status: 'running' }));

// ─── Startup ──────────────────────────────────────────────────────────────────

async function connectDatabases(retries = 10, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Connecting to databases (attempt ${attempt}/${retries})...`);
      await postgres.connect();
      await mongo.connect();
      await neo4j.connect();
      logger.info('All database connections established');
      return;
    } catch (err) {
      logger.error(`Database connection attempt ${attempt} failed`, { error: err.message });
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function ensureSchema() {
  // Ensure packages collection has proper indexes
  try {
    const collection = await mongo.getCollection('packages');
    await collection.createIndex({ package_id: 1 }, { unique: true });
    logger.info('MongoDB indexes ensured');
  } catch (err) {
    logger.warn('Could not create MongoDB index (may already exist)', { error: err.message });
  }

  // Ensure Neo4j constraints
  try {
    await neo4j.runQuery('CREATE CONSTRAINT driver_id IF NOT EXISTS FOR (d:Driver) REQUIRE d.driverId IS UNIQUE');
    await neo4j.runQuery('CREATE CONSTRAINT zone_id IF NOT EXISTS FOR (z:Zone) REQUIRE z.zoneId IS UNIQUE');
    logger.info('Neo4j constraints ensured');
  } catch (err) {
    logger.warn('Could not create Neo4j constraints (may already exist)', { error: err.message });
  }
}

async function main() {
  logger.info('Starting logistics platform...');

  try {
    await connectDatabases();
    await ensureSchema();

    // Auto-ingest events.log on startup
    logger.info('Starting automatic event ingestion...');
    const stats = await ingestLogFile();
    logger.info('Initial ingestion complete', stats);

    // Run reconciliation after ingestion
    logger.info('Running reconciliation pass...');
    await runReconciliation();

    // Start HTTP server
    app.listen(PORT, () => {
      logger.info(`API server listening on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/query/health`);
      logger.info(`Package query: http://localhost:${PORT}/query/package/:package_id`);
    });
  } catch (err) {
    logger.error('Fatal startup error', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await postgres.close();
    await mongo.close();
    await neo4j.close();
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main();
