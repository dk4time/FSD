'use strict';
// npm run check-atlas : connects, pings and prints the database name (or a readable error)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { MongoClient } = require('mongodb');

(async () => {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || 'webdev_assessment';
  if (!uri || uri.includes('USER:PASSWORD')) {
    console.error('MONGODB_URI is not set in collector/.env (copy collector/.env.example and fill it in).');
    process.exit(1);
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    const cols = await client.db(dbName).listCollections().toArray();
    console.log(`OK: connected to database "${dbName}" (${cols.length} collections: ${cols.map((c) => c.name).join(', ') || 'none yet'})`);
  } catch (err) {
    let hint = '';
    if (/auth/i.test(err.message)) hint = ' -> check the user name and password in MONGODB_URI.';
    else if (/ENOTFOUND|querySrv/i.test(err.message)) hint = ' -> check the cluster host name and your internet connection.';
    else if (/timed out|Server selection/i.test(err.message)) hint = ' -> add this laptop\'s IP under Atlas Network Access.';
    console.error(`FAILED to reach Atlas: ${err.message}${hint}`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
})();
