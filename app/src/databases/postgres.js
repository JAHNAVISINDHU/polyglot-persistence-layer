const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

async function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'logistics',
      password: process.env.POSTGRES_PASSWORD || 'logistics_pass',
      database: process.env.POSTGRES_DB || 'logistics_db',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL pool error', { error: err.message });
    });
  }
  return pool;
}

async function query(text, params) {
  const client = await (await getPool()).connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

async function connect() {
  const p = await getPool();
  const client = await p.connect();
  client.release();
  logger.info('PostgreSQL connection verified');
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}

module.exports = { query, connect, close };
