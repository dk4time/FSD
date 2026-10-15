'use strict';
const { MongoClient } = require('mongodb');

async function connect(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  await ensureIndexes(db);
  return { client, db };
}

async function ensureIndexes(db) {
  await db.collection('runs').createIndexes([
    { key: { runId: 1 }, name: 'runId_unique', unique: true },
    { key: { registrationNumber: 1, mode: 1, receivedAt: -1 }, name: 'reg_mode_received' },
    { key: { setId: 1, score: -1 }, name: 'set_score' },
  ]);
  // a laptop (deviceId) can be bound to only one registration number
  await db.collection('roster').createIndexes([
    { key: { deviceId: 1 }, name: 'deviceId_unique', unique: true, partialFilterExpression: { deviceId: { $type: 'string' } } },
  ]);
  await db.collection('laptopConflicts').createIndexes([{ key: { at: -1 }, name: 'at' }]);
  await db.collection('trainerRuns').createIndexes([
    { key: { runId: 1 }, name: 'runId_unique', unique: true },
    { key: { registrationNumber: 1, receivedAt: -1 }, name: 'reg_received' },
  ]);
}

module.exports = { connect, ensureIndexes };
