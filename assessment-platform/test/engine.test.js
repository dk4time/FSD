'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { runSet, summarize, TEST_IDS } = require('../core/engine');
const { createApp, loadConfig } = require('../trainer-only/reference/server');
const { freePort } = require('../trainer-only/refproc');

const cfg = loadConfig('P1');

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('reference server scores 100/100 with zero BLOCKED', async () => {
  const s = createApp(cfg).listen(0);
  try {
    const run = await runSet({ config: cfg, url: `http://127.0.0.1:${s.address().port}`, seed: 7, waitSeconds: 5 });
    assert.equal(run.status, 'COMPLETED');
    assert.deepEqual(run.results.map((r) => r.id), TEST_IDS);
    const sum = summarize(run.results);
    assert.equal(sum.score, 100, run.results.filter((r) => r.status !== 'PASS').map((r) => `${r.id} ${JSON.stringify(r.detail)}`).join('\n'));
    assert.equal(sum.blocked, 0);
  } finally {
    s.close();
  }
});

test('runner marks BLOCKED when the seed POSTs fail', async () => {
  // list works and is empty, every POST is a 500
  const s = await listen((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url.startsWith('/api/products')) {
      res.end(JSON.stringify({ data: [], page: 1, limit: 10, total: 0, totalPages: 0 }));
    } else {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'boom' }));
    }
  });
  try {
    const run = await runSet({ config: cfg, url: `http://127.0.0.1:${s.address().port}`, seed: 1, waitSeconds: 5 });
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.results.length, 100);
    const neverBlocked = new Set([...Array.from({ length: 14 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`), 'H02']);
    for (const r of run.results) {
      if (neverBlocked.has(r.id)) assert.notEqual(r.status, 'BLOCKED', r.id);
      else assert.equal(r.status, 'BLOCKED', r.id);
    }
    assert.equal(summarize(run.results).blocked, 85);
  } finally {
    s.close();
  }
});

test('a test whose own scratch POST fails is BLOCKED on its own', async () => {
  const app = createApp(cfg);
  let posts = 0;
  // accept the 45 seed POSTs and C03, then refuse further creates
  const s = await listen((req, res) => {
    if (req.method === 'POST' && ++posts > 46) {
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      return res.end('{"error":"busy"}');
    }
    app(req, res);
  });
  try {
    const run = await runSet({ config: cfg, url: `http://127.0.0.1:${s.address().port}`, seed: 3, waitSeconds: 5, only: ['C03', 'R01', 'U01', 'P01', 'D01', 'D05'] });
    const st = Object.fromEntries(run.results.map((r) => [r.id, r.status]));
    assert.deepEqual(st, { C03: 'PASS', R01: 'PASS', U01: 'BLOCKED', P01: 'BLOCKED', D01: 'BLOCKED', D05: 'PASS' });
  } finally {
    s.close();
  }
});

test('ABORT when the server is not empty', async () => {
  const s = createApp(cfg).listen(0);
  const url = `http://127.0.0.1:${s.address().port}`;
  try {
    await fetch(`${url}/api/products`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg.sample) });
    const run = await runSet({ config: cfg, url, seed: 1, waitSeconds: 5 });
    assert.equal(run.status, 'ABORTED');
    assert.equal(run.abortReason, 'not-empty');
    assert.deepEqual(run.results, []);
  } finally {
    s.close();
  }
});

test('ABORT when nothing is listening', async () => {
  const port = await freePort();
  const t = Date.now();
  const run = await runSet({ config: cfg, url: `http://127.0.0.1:${port}`, seed: 1, waitSeconds: 1, pollMs: 200 });
  assert.equal(run.status, 'ABORTED');
  assert.equal(run.abortReason, 'unreachable');
  assert.ok(Date.now() - t < 10000);
});

test('run time limit turns the remaining tests into FAIL', async () => {
  const app = createApp(cfg);
  const s = await listen((req, res) => setTimeout(() => app(req, res), 15));
  try {
    const run = await runSet({ config: cfg, url: `http://127.0.0.1:${s.address().port}`, seed: 1, waitSeconds: 5, timeLimitMs: 1500 });
    const limited = run.results.filter((r) => r.detail && r.detail.actual === 'run time limit');
    assert.ok(limited.length > 0);
    assert.ok(limited.every((r) => r.status === 'FAIL'));
    assert.equal(run.results.length, 100);
  } finally {
    s.close();
  }
});
