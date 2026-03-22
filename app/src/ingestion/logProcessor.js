const fs = require('fs');
const readline = require('readline');
const path = require('path');
const logger = require('../utils/logger');
const { handleDriverLocationUpdate, handlePackageStatusChange, handleBillingEvent } = require('./eventHandlers');

const LOG_PATH = process.env.LOG_PATH || path.join('/app', 'events.log');

const EVENT_HANDLERS = {
  DRIVER_LOCATION_UPDATE: handleDriverLocationUpdate,
  PACKAGE_STATUS_CHANGE: handlePackageStatusChange,
  BILLING_EVENT: handleBillingEvent,
};

async function processEvent(event, lineNumber) {
  const { event_type } = event;

  const handler = EVENT_HANDLERS[event_type];
  if (!handler) {
    logger.warn('Unknown event type, skipping', { event_type, lineNumber });
    return;
  }

  try {
    await handler(event);
  } catch (err) {
    logger.error('Failed to process event', {
      event_type,
      event_id: event.event_id,
      lineNumber,
      error: err.message,
    });
  }
}

async function ingestLogFile(filePath = LOG_PATH) {
  if (!fs.existsSync(filePath)) {
    logger.warn('events.log not found, skipping ingestion', { filePath });
    return { processed: 0, errors: 0, skipped: 0 };
  }

  logger.info('Starting log file ingestion', { filePath });

  const stats = { processed: 0, errors: 0, skipped: 0 };

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;
    const trimmed = line.trim();

    if (!trimmed) {
      stats.skipped++;
      continue;
    }

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (parseErr) {
      logger.error('Malformed JSON line in events.log, skipping', {
        lineNumber,
        content: trimmed.substring(0, 100),
        error: parseErr.message,
      });
      stats.errors++;
      continue;
    }

    await processEvent(event, lineNumber);
    stats.processed++;
  }

  logger.info('Log file ingestion complete', stats);
  return stats;
}

module.exports = { ingestLogFile };
