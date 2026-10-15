'use strict';
// Starts / stops the reference server as a child process on a free port.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const SERVER = path.join(__dirname, 'reference', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startReference(setId, mutant = '', port) {
  port = port || (await freePort());
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, SET_ID: setId, MUTANT: mutant, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errText = '';
  child.stderr.on('data', (d) => (errText += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`reference did not start: ${errText}`)), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`reference exited with code ${code}: ${errText}`));
    });
  });
  child.removeAllListeners('exit');
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}

module.exports = { startReference, freePort };
