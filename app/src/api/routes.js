const express = require('express');
const router = express.Router();
const postgres = require('../databases/postgres');
const mongo = require('../databases/mongo');
const neo4j = require('../databases/neo4j');
const { runReconciliation } = require('../reconciliation/reconciler');
const { ingestLogFile } = require('../ingestion/logProcessor');
const logger = require('../utils/logger');

// ─── GET /query/package/:package_id ──────────────────────────────────────────
// Returns unified, chronologically sorted history for a package

router.get('/package/:package_id', async (req, res) => {
  const { package_id } = req.params;
  const events = [];

  try {
    // 1. Fetch from MongoDB (Document Store) — status history
    try {
      const collection = await mongo.getCollection('packages');
      const doc = await collection.findOne({ package_id });

      if (doc && doc.status_history) {
        for (const entry of doc.status_history) {
          events.push({
            source_system: 'document_store',
            timestamp: entry.timestamp,
            event_details: {
              status: entry.status,
              driver_id: entry.driver_id,
              location: entry.location,
              event_id: entry.event_id,
            },
          });
        }
      }
    } catch (err) {
      logger.error('Failed to query MongoDB for package history', { package_id, error: err.message });
    }

    // 2. Fetch from PostgreSQL (Relational Store) — billing events
    try {
      const result = await postgres.query(
        'SELECT * FROM invoices WHERE package_id = $1',
        [package_id]
      );
      for (const row of result.rows) {
        events.push({
          source_system: 'relational_store',
          timestamp: row.timestamp,
          event_details: {
            invoice_id: row.invoice_id,
            amount: parseFloat(row.amount),
            customer_id: row.customer_id,
            currency: row.currency,
            event_id: row.event_id,
          },
        });
      }
    } catch (err) {
      logger.error('Failed to query PostgreSQL for package history', { package_id, error: err.message });
    }

    // 3. Fetch from Neo4j (Graph Store) — driver location events linked to package
    try {
      const cypher = `
        MATCH (d:Driver)-[r:LOCATED_IN]->(z:Zone)
        WHERE d.lastPackageId = $packageId OR d.eventId CONTAINS $packageId
        RETURN d.driverId AS driverId, d.latitude AS latitude,
               d.longitude AS longitude, d.lastSeen AS timestamp,
               z.zoneId AS zoneId, d.eventId AS eventId
      `;
      // Also try fetching any driver location tied to this package
      const cypher2 = `
        MATCH (d:Driver {lastPackageId: $packageId})-[:LOCATED_IN]->(z:Zone)
        RETURN d.driverId AS driverId, d.latitude AS latitude,
               d.longitude AS longitude, d.lastSeen AS timestamp,
               z.zoneId AS zoneId, d.eventId AS eventId
      `;

      const records = await neo4j.runQuery(cypher2, { packageId: package_id });
      for (const record of records) {
        events.push({
          source_system: 'graph_store',
          timestamp: record.get('timestamp'),
          event_details: {
            driver_id: record.get('driverId'),
            latitude: record.get('latitude'),
            longitude: record.get('longitude'),
            zone_id: record.get('zoneId'),
            event_id: record.get('eventId'),
          },
        });
      }
    } catch (err) {
      logger.error('Failed to query Neo4j for package history', { package_id, error: err.message });
    }

    // Sort all events by timestamp ascending
    events.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    return res.status(200).json(events);
  } catch (err) {
    logger.error('Unexpected error in package history query', { package_id, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /ingest ─────────────────────────────────────────────────────────────
// Trigger re-ingestion of events.log manually

router.post('/ingest', async (req, res) => {
  try {
    const stats = await ingestLogFile();
    await runReconciliation();
    return res.status(200).json({ message: 'Ingestion complete', stats });
  } catch (err) {
    logger.error('Ingestion failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /reconcile ──────────────────────────────────────────────────────────
// Trigger reconciliation manually

router.post('/reconcile', async (req, res) => {
  try {
    const result = await runReconciliation();
    return res.status(200).json({ message: 'Reconciliation complete', result });
  } catch (err) {
    logger.error('Reconciliation failed', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /health ──────────────────────────────────────────────────────────────

router.get('/health', async (req, res) => {
  const health = { status: 'ok', databases: {} };

  try {
    await postgres.query('SELECT 1');
    health.databases.postgres = 'healthy';
  } catch {
    health.databases.postgres = 'unhealthy';
    health.status = 'degraded';
  }

  try {
    const collection = await mongo.getCollection('health_check');
    await collection.findOne({});
    health.databases.mongo = 'healthy';
  } catch {
    health.databases.mongo = 'unhealthy';
    health.status = 'degraded';
  }

  try {
    await neo4j.runQuery('RETURN 1');
    health.databases.neo4j = 'healthy';
  } catch {
    health.databases.neo4j = 'unhealthy';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  return res.status(statusCode).json(health);
});

// ─── GET /queue ───────────────────────────────────────────────────────────────
// Inspect the retry queue

router.get('/queue', (req, res) => {
  const retryQueue = require('../utils/retryQueue');
  const queue = retryQueue.getAll();
  return res.status(200).json({ count: queue.length, events: queue });
});

module.exports = router;
