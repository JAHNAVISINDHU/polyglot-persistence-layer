const { MongoClient } = require('mongodb');
const logger = require('../utils/logger');

let client;
let db;

async function getDb() {
  if (!client || !client.topology?.isConnected()) {
    const uri = process.env.MONGO_URI || 'mongodb://logistics:logistics_pass@localhost:27017/logistics_db?authSource=admin';
    client = new MongoClient(uri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
    });
    await client.connect();
    db = client.db(process.env.MONGO_DB || 'logistics_db');
    logger.info('MongoDB connected');
  }
  return db;
}

async function connect() {
  await getDb();
  logger.info('MongoDB connection verified');
}

async function getCollection(name) {
  const database = await getDb();
  return database.collection(name);
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed');
  }
}

module.exports = { connect, getCollection, getDb, close };
