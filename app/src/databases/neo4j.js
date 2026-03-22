const neo4j = require('neo4j-driver');
const logger = require('../utils/logger');

let driver;

function getDriver() {
  if (!driver) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = process.env.NEO4J_USER || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || 'logistics_pass';

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      connectionTimeout: 10000,
      maxConnectionPoolSize: 10,
    });
  }
  return driver;
}

async function connect() {
  const d = getDriver();
  await d.verifyConnectivity();
  logger.info('Neo4j connection verified');
}

async function runQuery(cypher, params = {}) {
  const session = getDriver().session();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

async function close() {
  if (driver) {
    await driver.close();
    driver = null;
    logger.info('Neo4j driver closed');
  }
}

module.exports = { connect, runQuery, close };
