'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { createApp, checksumInput } = require('../server');
const { ensureIndexes } = require('../db');
const { pinFor } = require('../pins');

const KEY = 'test-collector-key';
const ADMIN = 'test-admin-password';
const PIN_SECRET = 'test-pin-secret';
const GROUP_SIZES = { C: 14, R: 8, L: 8, U: 10, P: 10, D: 8, G: 12, F: 10, S: 8, O: 6, X: 4, H: 2 };
const IDS = Object.entries(GROUP_SIZES).flatMap(([p, n]) => Array.from({ length: n }, (_, k) => `${p}${String(k + 1).padStart(2, '0')}`));

let mongod;
let client;
let db;

// one simulated laptop per registration number (a laptop can be bound to only one student)
const laptopOf = (reg, n = 1) => crypto.createHash('sha256').update(`laptop|${reg}|${n}`).digest('hex').slice(0, 32);

function makeDoc({ reg = '22CS001', setId, mode = 'assessment', passCount = 70, note, deviceId } = {}) {
  const doc = {
    runId: crypto.randomUUID(),
    registrationNumber: reg,
    setId: setId || 'A6',
    mode,
    seed: 12345,
    evaluatorVersion: '1.0.0',
    startedAt: new Date(Date.now() - 40000).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 40000,
    serverUrl: 'http://localhost:8080',
    tests: IDS.map((id, i) => ({ id, status: i < passCount ? 'PASS' : i % 7 === 0 ? 'BLOCKED' : 'FAIL' })),
  };
  if (note !== undefined) doc.note = note;
  if (mode !== 'trainer') {
    doc.pin = pinFor(PIN_SECRET, reg);
    doc.deviceId = deviceId || laptopOf(reg);
  }
  doc.checksum = crypto.createHmac('sha256', KEY).update(checksumInput(doc)).digest('hex');
  return doc;
}

async function startApp(opts = {}) {
  const app = createApp({ db, collectorKey: KEY, adminPassword: ADMIN, pinSecret: PIN_SECRET, ...opts });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

const adminHeaders = { authorization: 'Basic ' + Buffer.from(`admin:${ADMIN}`).toString('base64') };

async function post(base, path, body, headers = { 'x-collector-key': KEY }) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('webdev_assessment_test');
  await ensureIndexes(db);
});

after(async () => {
  await client.close();
  await mongod.stop();
});

// puts registration numbers on the roster in an open slot (only roster students of an open slot may submit)
async function enroll(...regs) {
  await db.collection('slots').updateOne({ _id: 'test-slot' }, { $set: { open: true, closesAt: null } }, { upsert: true });
  for (const reg of regs) await db.collection('roster').updateOne({ _id: reg }, { $set: { name: `Student ${reg}`, section: 'A', slot: 'test-slot' } }, { upsert: true });
}

async function setSlot(app, slot, body) {
  const res = await fetch(app.base + `/admin/api/slots/${encodeURIComponent(slot)}`, { method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.status;
}

beforeEach(async () => {
  for (const c of ['runs', 'students', 'trainerRuns', 'roster', 'laptopConflicts', 'slots']) await db.collection(c).deleteMany({});
  await enroll('22CS001');
});

test('accepts a valid result and responds {ok:true} with no score', async () => {
  const app = await startApp();
  try {
    const r = await post(app.base, '/api/results', makeDoc());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    const run = await db.collection('runs').findOne({});
    assert.equal(run.score, 70);
    assert.equal(run.passed + run.failed + run.blocked, 100);
    assert.equal(run.groupScores.create, 14);
  } finally {
    await app.close();
  }
});

test('rejects bad key, bad checksum, unknown set, practice and trainer modes on the student route', async () => {
  const app = await startApp();
  try {
    assert.equal((await post(app.base, '/api/results', makeDoc(), { 'x-collector-key': 'nope' })).status, 401);
    assert.equal((await post(app.base, '/api/results', makeDoc(), {})).status, 401);

    const tampered = makeDoc({ passCount: 10 });
    tampered.tests[50].status = 'PASS';
    assert.equal((await post(app.base, '/api/results', tampered)).status, 400);

    const unknownSet = makeDoc({ setId: 'A9' });
    const r = await post(app.base, '/api/results', unknownSet);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /unknown set/);

    assert.equal((await post(app.base, '/api/results', makeDoc({ mode: 'practice' }))).status, 400);
    assert.equal((await post(app.base, '/api/results', makeDoc({ mode: 'trainer' }))).status, 400);

    const extra = makeDoc();
    extra.score = 100;
    assert.equal((await post(app.base, '/api/results', extra)).status, 400);

    const dupIds = makeDoc();
    dupIds.tests[1].id = 'C01';
    assert.equal((await post(app.base, '/api/results', dupIds)).status, 400);

    assert.equal(await db.collection('runs').countDocuments(), 0);
  } finally {
    await app.close();
  }
});

test('rejection messages never use result vocabulary', async () => {
  const app = await startApp();
  try {
    const cases = [makeDoc({ mode: 'practice' }), { ...makeDoc(), checksum: 'ab'.repeat(32) }, makeDoc({ setId: 'A9' })];
    for (const doc of cases) {
      const r = await post(app.base, '/api/results', doc);
      assert.equal(r.status, 400);
      assert.doesNotMatch(r.body.error, /PASS|FAIL|BLOCKED|score|passed|failed/i);
    }
  } finally {
    await app.close();
  }
});

test('duplicate runId is idempotent', async () => {
  const app = await startApp();
  try {
    const doc = makeDoc();
    assert.equal((await post(app.base, '/api/results', doc)).status, 200);
    const again = await post(app.base, '/api/results', doc);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { ok: true });
    assert.equal(await db.collection('runs').countDocuments(), 1);
  } finally {
    await app.close();
  }
});

test('student summary tracks best, latest and attempts', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    for (const n of [40, 85, 60]) assert.equal((await post(app.base, '/api/results', makeDoc({ passCount: n }))).status, 200);
    const s = await db.collection('students').findOne({ _id: '22CS001' });
    assert.equal(s.assignedSet, 'A6');
    assert.equal(s.assessment.best, 85);
    assert.equal(s.assessment.latest, 60);
    assert.equal(s.assessment.attempts, 3);
    const bestRun = await db.collection('runs').findOne({ runId: s.assessment.bestRunId });
    assert.equal(bestRun.score, 85);
    assert.deepEqual(s.assessment.bestGroupScores, bestRun.groupScores);
  } finally {
    await app.close();
  }
});

test('any set is accepted; after a set change the summary follows the new set only', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  await enroll('22CS777');
  try {
    // 90 under a wrong set (A2), then the student changes to A5 (npm run whoami -- --change) and scores 30, 60
    for (const [setId, passCount] of [['A2', 90], ['A5', 30], ['A5', 60]]) {
      assert.equal((await post(app.base, '/api/results', makeDoc({ reg: '22CS777', setId, passCount }))).status, 200);
    }
    const s = await db.collection('students').findOne({ _id: '22CS777' });
    assert.equal(s.assignedSet, 'A5');
    assert.equal(s.assessment.attempts, 2, 'only runs of the current set count');
    assert.equal(s.assessment.best, 60, 'the 90 from the wrong set is not the best');
    assert.equal(s.assessment.latest, 60);
    assert.equal(await db.collection('runs').countDocuments({ registrationNumber: '22CS777' }), 3, 'history keeps every run');
  } finally {
    await app.close();
  }
});

test('rate limit: one submission per registration number per 20 seconds', async () => {
  const app = await startApp();
  try {
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 200);
    const r = await post(app.base, '/api/results', makeDoc());
    assert.equal(r.status, 429);
    await enroll('23EC090');
    assert.equal((await post(app.base, '/api/results', makeDoc({ reg: '23EC090' }))).status, 200);
  } finally {
    await app.close();
  }
});

test('trainer route stores in trainerRuns without changing students', async () => {
  const app = await startApp();
  try {
    assert.equal((await post(app.base, '/api/results', makeDoc({ passCount: 90 }))).status, 200);
    const before = await db.collection('students').findOne({ _id: '22CS001' });

    const doc = makeDoc({ mode: 'trainer', setId: 'P1', passCount: 30, note: 're-run' });
    assert.equal((await post(app.base, '/admin/api/trainer-runs', doc, {})).status, 401);
    const r = await post(app.base, '/admin/api/trainer-runs', doc, adminHeaders);
    assert.equal(r.status, 200);
    assert.equal(r.body.score, 30);
    assert.equal(await db.collection('trainerRuns').countDocuments(), 1);
    assert.equal(await db.collection('runs').countDocuments(), 1);
    const after = await db.collection('students').findOne({ _id: '22CS001' });
    assert.deepEqual(after.assessment, before.assessment);

    const empty = makeDoc({ mode: 'trainer', reg: '', setId: 'A3', note: '' });
    assert.equal((await post(app.base, '/admin/api/trainer-runs', empty, adminHeaders)).status, 200);
    assert.equal((await post(app.base, '/admin/api/trainer-runs', makeDoc({ mode: 'assessment' }), adminHeaders)).status, 400);
  } finally {
    await app.close();
  }
});

test('CSV export has one row per student with the documented columns', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    const rr = await fetch(app.base + '/admin/api/roster?slot=test-slot', { method: 'POST', headers: { ...adminHeaders, 'content-type': 'text/csv' }, body: 'reg,name,section\n22CS001,Asha K,A\n21IT145,Ravi S,B\n23EC090,Meena R,C\n' });
    assert.equal(rr.status, 200);
    await post(app.base, '/api/results', makeDoc({ passCount: 55 }));
    await post(app.base, '/api/results', makeDoc({ reg: '23EC090', passCount: 100 }));

    const res = await fetch(app.base + '/admin/api/export.csv', { headers: adminHeaders });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const lines = (await res.text()).replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines[0], 'registrationNumber,name,section,slot,assignedSet,best,latest,attempts,best_create,best_readOne,best_list,best_update,best_patch,best_delete,best_pagination,best_filter,best_search,best_sort,best_combined,best_http,lastRunAt');
    assert.equal(lines.length, 3);
    const row = lines[1].split(',');
    assert.equal(row[0], '22CS001');
    assert.equal(row[1], 'Asha K');
    assert.equal(row[3], 'test-slot');
    assert.equal(row[5], '55');
    assert.equal(lines[2].split(',')[5], '100');

    const ns = await (await fetch(app.base + '/admin/api/not-started', { headers: adminHeaders })).json();
    assert.deepEqual(ns.map((r) => r.registrationNumber), ['21IT145']);

    assert.equal((await fetch(app.base + '/admin/api/students')).status, 401);
    const page = await fetch(app.base + '/admin/', { headers: adminHeaders });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Assessment dashboard/);
  } finally {
    await app.close();
  }
});

test('deleting a run rebuilds the summary; deleting a student removes everything', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    const a = makeDoc({ passCount: 90 });
    await post(app.base, '/api/results', a);
    await post(app.base, '/api/results', makeDoc({ passCount: 20 }));
    let res = await fetch(`${app.base}/admin/api/runs/${a.runId}`, { method: 'DELETE', headers: adminHeaders });
    assert.equal(res.status, 200);
    let s = await db.collection('students').findOne({ _id: '22CS001' });
    assert.equal(s.assessment.best, 20);
    assert.equal(s.assessment.attempts, 1);
    res = await fetch(`${app.base}/admin/api/students/22CS001`, { method: 'DELETE', headers: adminHeaders });
    assert.equal(res.status, 200);
    s = await db.collection('students').findOne({ _id: '22CS001' });
    assert.equal(s, null);
    assert.equal(await db.collection('runs').countDocuments(), 0);
  } finally {
    await app.close();
  }
});

// ---- roster + PIN (only students on the roster, with the PIN from their slip, can submit) -------------

test('PINs are 6 digits, stable, and independent of letter case in the registration number', () => {
  const pin = pinFor(PIN_SECRET, '22CS001');
  assert.match(pin, /^\d{6}$/);
  assert.equal(pinFor(PIN_SECRET, '22cs001 '), pin);
  assert.notEqual(pinFor('another-secret', '22CS001'), pin);
});

test('results for a registration number that is not on the roster are rejected', async () => {
  const app = await startApp();
  try {
    const r = await post(app.base, '/api/results', makeDoc({ reg: '99XX999' }));
    assert.equal(r.status, 403);
    assert.match(r.body.error, /not on the class list/);
    assert.equal(await db.collection('runs').countDocuments(), 0);
  } finally {
    await app.close();
  }
});

test('a wrong or missing PIN is rejected and nothing is stored', async () => {
  const app = await startApp();
  try {
    const wrong = makeDoc();
    wrong.pin = wrong.pin === '000000' ? '111111' : '000000';
    let r = await post(app.base, '/api/results', wrong);
    assert.equal(r.status, 403);
    assert.match(r.body.error, /PIN does not match/);

    const missing = makeDoc();
    delete missing.pin;
    r = await post(app.base, '/api/results', missing);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /missing field "pin"/);

    r = await post(app.base, '/api/results', { ...makeDoc(), pin: '12ab56' });
    assert.equal(r.status, 400);
    assert.equal(await db.collection('runs').countDocuments(), 0);
  } finally {
    await app.close();
  }
});

test('five wrong PINs lock that registration number for this client, even with the right PIN', async () => {
  const app = await startApp();
  try {
    const good = pinFor(PIN_SECRET, '22CS001');
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await post(app.base, '/api/verify-student', { registrationNumber: '22CS001', pin: bad, deviceId: laptopOf('22CS001') });
      assert.equal(r.status, 403);
    }
    const r = await post(app.base, '/api/verify-student', { registrationNumber: '22CS001', pin: good, deviceId: laptopOf('22CS001') });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /Too many wrong PINs/);
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 429);
  } finally {
    await app.close();
  }
});

test('verify-student checks the key, the roster and the PIN', async () => {
  const app = await startApp();
  try {
    const pin = pinFor(PIN_SECRET, '22CS001');
    let r = await post(app.base, '/api/verify-student', { registrationNumber: '22cs001', pin, deviceId: laptopOf('22CS001') });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, name: 'Student 22CS001' });
    r = await post(app.base, '/api/verify-student', { registrationNumber: '22CS001', pin, deviceId: laptopOf('22CS001') }, { 'x-collector-key': 'nope' });
    assert.equal(r.status, 401);
    r = await post(app.base, '/api/verify-student', { registrationNumber: '99XX999', pin: pinFor(PIN_SECRET, '99XX999'), deviceId: laptopOf('99XX999') });
    assert.equal(r.status, 403);
    r = await post(app.base, '/api/verify-student', { registrationNumber: '22CS001', pin: '12345', deviceId: laptopOf('22CS001') });
    assert.equal(r.status, 400);
  } finally {
    await app.close();
  }
});

test('PIN slips and PIN CSV list every roster student and need the admin password', async () => {
  const app = await startApp();
  await enroll('23EC090');
  try {
    assert.equal((await fetch(app.base + '/admin/api/pins.csv')).status, 401);
    const csv = (await (await fetch(app.base + '/admin/api/pins.csv', { headers: adminHeaders })).text()).replace(/^\ufeff/, '').trim().split('\r\n');
    assert.equal(csv[0], 'registrationNumber,name,section,pin');
    assert.equal(csv[1], `22CS001,Student 22CS001,A,${pinFor(PIN_SECRET, '22CS001')}`);
    assert.equal(csv.length, 3);
    const html = await (await fetch(app.base + '/admin/api/pin-slips', { headers: adminHeaders })).text();
    assert.match(html, new RegExp(`PIN: ${pinFor(PIN_SECRET, '23EC090')}`));
    assert.match(html, /2 slips/);
  } finally {
    await app.close();
  }
});

// ---- one laptop per student ------------------------------------------------------------------------------

const verify = (app, reg, deviceId) => post(app.base, '/api/verify-student', { registrationNumber: reg, pin: pinFor(PIN_SECRET, reg), deviceId });

test('the first laptop is bound; a second laptop for that number is rejected and logged', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    assert.equal((await verify(app, '22CS001', laptopOf('22CS001'))).status, 200);
    const r = await verify(app, '22CS001', laptopOf('22CS001', 2));
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'SECOND_LAPTOP');
    const res = await post(app.base, '/api/results', makeDoc({ deviceId: laptopOf('22CS001', 2) }));
    assert.equal(res.status, 403);
    assert.equal(await db.collection('runs').countDocuments(), 0);
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 200, 'the bound laptop still works');
    const log = await (await fetch(app.base + '/admin/api/laptop-conflicts', { headers: adminHeaders })).json();
    assert.equal(log.length, 2);
    assert.match(log[0].kind, /second laptop/);
  } finally {
    await app.close();
  }
});

test('a laptop bound to one student is rejected for another registration number (shared PIN)', async () => {
  const app = await startApp();
  await enroll('22CS014');
  try {
    assert.equal((await verify(app, '22CS001', laptopOf('22CS001'))).status, 200);
    const r = await post(app.base, '/api/results', makeDoc({ reg: '22CS014', deviceId: laptopOf('22CS001') }));
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'LAPTOP_TAKEN');
    assert.equal(await db.collection('runs').countDocuments(), 0);
    const [entry] = await (await fetch(app.base + '/admin/api/laptop-conflicts', { headers: adminHeaders })).json();
    assert.equal(entry.registrationNumber, '22CS014');
    assert.equal(entry.otherRegistrationNumber, '22CS001');
  } finally {
    await app.close();
  }
});

test('a wrong PIN never binds a laptop', async () => {
  const app = await startApp();
  try {
    const good = pinFor(PIN_SECRET, '22CS001');
    await post(app.base, '/api/verify-student', { registrationNumber: '22CS001', pin: good === '000000' ? '111111' : '000000', deviceId: laptopOf('X') });
    assert.equal((await db.collection('roster').findOne({ _id: '22CS001' })).deviceId, undefined);
  } finally {
    await app.close();
  }
});

test('Reset laptop frees the binding; re-uploading the roster keeps it; the detail view shows it', async () => {
  const app = await startApp();
  try {
    assert.equal((await verify(app, '22CS001', laptopOf('22CS001'))).status, 200);
    const up = await fetch(app.base + '/admin/api/roster?slot=test-slot', { method: 'POST', headers: { ...adminHeaders, 'content-type': 'text/csv' }, body: 'reg,name,section\n22CS001,Asha K,B\n' });
    assert.equal(up.status, 200);
    const enrolled = await db.collection('roster').findOne({ _id: '22CS001' });
    assert.equal(enrolled.deviceId, laptopOf('22CS001'), 'roster re-upload keeps the laptop');
    assert.equal(enrolled.section, 'B');
    const detail = await (await fetch(app.base + '/admin/api/students/22CS001', { headers: adminHeaders })).json();
    assert.equal(detail.laptop.deviceId, laptopOf('22CS001'));

    assert.equal((await verify(app, '22CS001', laptopOf('22CS001', 2))).status, 403);
    const reset = await fetch(app.base + '/admin/api/students/22CS001/reset-laptop', { method: 'POST', headers: adminHeaders });
    assert.equal(reset.status, 200);
    assert.equal((await verify(app, '22CS001', laptopOf('22CS001', 2))).status, 200, 'the new laptop is accepted after a reset');
  } finally {
    await app.close();
  }
});

test('a result without a device id is rejected; stored runs keep the device id', async () => {
  const app = await startApp();
  try {
    const noDevice = makeDoc();
    delete noDevice.deviceId;
    assert.equal((await post(app.base, '/api/results', noDevice)).status, 400);
    const ok = makeDoc();
    assert.equal((await post(app.base, '/api/results', ok)).status, 200);
    assert.equal((await db.collection('runs').findOne({ runId: ok.runId })).deviceId, laptopOf('22CS001'));
  } finally {
    await app.close();
  }
});

// ---- slots (one per assessment session; only students of an open slot get in) -----------------------

test('a roster upload needs a slot name; a new slot starts closed and its students are refused until it is opened', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    const upload = (q) => fetch(app.base + `/admin/api/roster${q}`, { method: 'POST', headers: { ...adminHeaders, 'content-type': 'text/csv' }, body: 'reg,name,section\n23EC090,Meena R,C\n' });
    assert.equal((await upload('')).status, 400);
    assert.equal((await upload('?slot=bad%20name')).status, 400);
    assert.equal((await upload('?slot=sist-15-10-26-fn')).status, 200);
    assert.equal((await db.collection('roster').findOne({ _id: '23EC090' })).slot, 'sist-15-10-26-fn');

    const v = await post(app.base, '/api/verify-student', { registrationNumber: '23EC090', pin: pinFor(PIN_SECRET, '23EC090'), deviceId: laptopOf('23EC090') });
    assert.equal(v.status, 403);
    assert.equal(v.body.code, 'SLOT_CLOSED');
    assert.equal((await db.collection('roster').findOne({ _id: '23EC090' })).deviceId, undefined, 'a closed slot does not bind a laptop');
    assert.equal((await post(app.base, '/api/results', makeDoc({ reg: '23EC090' }))).status, 403);

    assert.equal(await setSlot(app, 'sist-15-10-26-fn', { open: true }), 200);
    assert.equal((await post(app.base, '/api/results', makeDoc({ reg: '23EC090' }))).status, 200);

    // re-uploading keeps the slot open
    assert.equal((await upload('?slot=sist-15-10-26-fn')).status, 200);
    assert.equal((await post(app.base, '/api/results', makeDoc({ reg: '23EC090' }))).status, 200);
  } finally {
    await app.close();
  }
});

test('closing a slot refuses its students but not students of another open slot', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    await enroll('23EC090');
    await db.collection('slots').insertOne({ _id: 'sist-12-10-26', open: false, closesAt: null });
    await db.collection('roster').updateOne({ _id: '22CS001' }, { $set: { slot: 'sist-12-10-26' } });
    const r = await post(app.base, '/api/results', makeDoc());
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'SLOT_CLOSED');
    assert.equal((await post(app.base, '/api/results', makeDoc({ reg: '23EC090' }))).status, 200);

    assert.equal(await setSlot(app, 'test-slot', { open: false }), 200);
    assert.equal((await post(app.base, '/api/results', makeDoc({ reg: '23EC090' }))).status, 403);
    assert.equal(await setSlot(app, 'no-such-slot', { open: true }), 404);
    assert.equal(await setSlot(app, 'test-slot', { open: 'yes' }), 400);
  } finally {
    await app.close();
  }
});

test('a student without a slot is refused (closed by default)', async () => {
  const app = await startApp();
  try {
    await db.collection('roster').updateOne({ _id: '22CS001' }, { $unset: { slot: '' } });
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 403);
    const { slots } = await (await fetch(app.base + '/admin/api/slots', { headers: adminHeaders })).json();
    assert.deepEqual(slots.find((s) => s.slot === ''), { slot: '', state: 'closed', opensAt: null, closesAt: null, students: 1, started: 0 });
  } finally {
    await app.close();
  }
});

test('a slot with a closing time closes by itself', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    assert.equal(await setSlot(app, 'test-slot', { open: true, closesAt: new Date(Date.now() + 60000).toISOString() }), 200);
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 200);
    // the dashboard cannot set a closing time in the past; a time that passes closes the slot
    assert.equal(await setSlot(app, 'test-slot', { open: true, closesAt: new Date(Date.now() - 1000).toISOString() }), 400);
    await db.collection('slots').updateOne({ _id: 'test-slot' }, { $set: { closesAt: new Date(Date.now() - 1000) } });
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 403);
    const body = await (await fetch(app.base + '/admin/api/slots', { headers: adminHeaders })).json();
    assert.ok(Math.abs(new Date(body.now).getTime() - Date.now()) < 5000, 'the server sends its clock');
    const s = body.slots.find((x) => x.slot === 'test-slot');
    assert.equal(s.state, 'ended');
    assert.equal(s.students, 1);
    assert.equal(s.started, 1);
  } finally {
    await app.close();
  }
});

test('PIN slips can be printed for one slot', async () => {
  const app = await startApp();
  try {
    await db.collection('roster').insertOne({ _id: '23EC090', name: 'Meena R', section: 'C', slot: 'other' });
    const html = await (await fetch(app.base + '/admin/api/pin-slips?slot=other', { headers: adminHeaders })).text();
    assert.match(html, /23EC090/);
    assert.doesNotMatch(html, /22CS001/);
  } finally {
    await app.close();
  }
});

test('a scheduled slot opens at its opening time; closing clears the window', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    const later = (min) => new Date(Date.now() + min * 60000).toISOString();
    assert.equal(await setSlot(app, 'test-slot', { open: true, opensAt: later(60), closesAt: later(30) }), 400, 'closing must be after opening');
    assert.equal(await setSlot(app, 'test-slot', { open: true, opensAt: later(60), closesAt: later(120) }), 200);
    const r = await post(app.base, '/api/results', makeDoc());
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'SLOT_CLOSED');
    const listed = (await (await fetch(app.base + '/admin/api/slots', { headers: adminHeaders })).json()).slots[0];
    assert.equal(listed.state, 'scheduled');

    // the opening time arrives
    await db.collection('slots').updateOne({ _id: 'test-slot' }, { $set: { opensAt: new Date(Date.now() - 1000) } });
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 200);

    assert.equal(await setSlot(app, 'test-slot', { open: false, opensAt: later(1), closesAt: later(2) }), 200);
    const closed = await db.collection('slots').findOne({ _id: 'test-slot' });
    assert.deepEqual([closed.open, closed.opensAt, closed.closesAt], [false, null, null]);
  } finally {
    await app.close();
  }
});

test('+10 min moves the closing time later, and reopens a slot whose time has passed', async () => {
  const app = await startApp({ rateLimitMs: 0 });
  try {
    const extend = async (body) => {
      const res = await fetch(app.base + '/admin/api/slots/test-slot/extend', { method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    assert.equal((await extend({ minutes: 10 })).status, 400, 'no closing time to extend');
    const closesAt = new Date(Date.now() + 5 * 60000);
    await db.collection('slots').updateOne({ _id: 'test-slot' }, { $set: { closesAt } });
    assert.equal((await extend({ minutes: 0 })).status, 400);
    const e = await extend({ minutes: 10 });
    assert.equal(e.status, 200);
    assert.equal(new Date(e.body.closesAt).getTime(), closesAt.getTime() + 10 * 60000);

    await db.collection('slots').updateOne({ _id: 'test-slot' }, { $set: { closesAt: new Date(Date.now() - 60000) } });
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 403);
    const again = await extend({ minutes: 10 });
    assert.equal(again.body.state, 'open');
    assert.ok(new Date(again.body.closesAt).getTime() > Date.now() + 9 * 60000, 'counted from now, not from the past closing time');
    assert.equal((await post(app.base, '/api/results', makeDoc())).status, 200);

    await db.collection('slots').updateOne({ _id: 'test-slot' }, { $set: { open: false } });
    assert.equal((await extend({ minutes: 10 })).status, 400, 'a closed slot is not extended');
  } finally {
    await app.close();
  }
});
