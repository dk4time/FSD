'use strict';
// Collector: runs on the trainer's laptop, receives results from student kits over the LAN and
// stores them in MongoDB Atlas. The Atlas connection string lives only in collector/.env.

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const express = require('express');
const { normalizeReg, REG_REGEX } = require('./assign');
const { computeScores, rebuildStudent, GROUP_KEYS } = require('./summary');
const { PIN_REGEX, pinFor, pinMatches, createPinLimiter } = require('./pins');

const TEST_ID = /^[CRLUPDGFSOXH][0-9]{2}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SET_ID = /^(P[12]|A([1-9]|10))$/;
const DEVICE_ID = /^[0-9a-f]{32}$/;
const SLOT_NAME = /^[A-Za-z0-9._-]{1,60}$/;
const STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED']);
const BASE_KEYS = ['runId', 'registrationNumber', 'setId', 'mode', 'seed', 'evaluatorVersion', 'startedAt', 'finishedAt', 'durationMs', 'serverUrl', 'tests', 'checksum'];

// Same formula as core/submit.js
function checksumInput(doc) {
  const passed = doc.tests.filter((t) => t.status === 'PASS').map((t) => t.id).sort();
  return [doc.registrationNumber, doc.setId, doc.mode, doc.seed, passed.join(','), doc.evaluatorVersion].join('|');
}

function verifyChecksum(key, doc) {
  if (typeof doc.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(doc.checksum)) return false;
  const want = crypto.createHmac('sha256', String(key)).update(checksumInput(doc)).digest();
  return crypto.timingSafeEqual(want, Buffer.from(doc.checksum, 'hex'));
}

const isIso = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));

// strict shape check; returns an error message (worded without any result vocabulary) or null
function validateShape(body, trainer) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Result rejected: body must be a JSON object';
  const required = trainer ? BASE_KEYS : [...BASE_KEYS, 'pin', 'deviceId'];
  const allowed = trainer ? [...BASE_KEYS, 'note'] : required;
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return `Result rejected: unexpected field "${k}"`;
  for (const k of required) if (body[k] === undefined) return `Result rejected: missing field "${k}"`;
  if (!trainer && (typeof body.pin !== 'string' || !PIN_REGEX.test(body.pin))) return 'Result rejected: the PIN must be 6 digits';
  if (!trainer && (typeof body.deviceId !== 'string' || !DEVICE_ID.test(body.deviceId))) return 'Result rejected: invalid device id. Ask the invigilator for a fresh kit.';
  if (typeof body.runId !== 'string' || !UUID_V4.test(body.runId)) return 'Result rejected: invalid runId';
  if (typeof body.registrationNumber !== 'string') return 'Result rejected: invalid registration number';
  if (!trainer || body.registrationNumber !== '') {
    if (!REG_REGEX.test(body.registrationNumber) || body.registrationNumber !== normalizeReg(body.registrationNumber)) {
      return 'Result rejected: invalid registration number';
    }
  }
  if (typeof body.setId !== 'string' || !SET_ID.test(body.setId)) return 'Result rejected: unknown set';
  if (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff) return 'Result rejected: invalid seed';
  if (typeof body.evaluatorVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(body.evaluatorVersion)) return 'Result rejected: invalid evaluator version';
  if (!isIso(body.startedAt) || !isIso(body.finishedAt)) return 'Result rejected: invalid timestamps';
  if (!Number.isInteger(body.durationMs) || body.durationMs < 0 || body.durationMs > 3600000) return 'Result rejected: invalid duration';
  if (typeof body.serverUrl !== 'string' || body.serverUrl.length > 200) return 'Result rejected: invalid server URL';
  if (trainer && body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) return 'Result rejected: invalid note';
  if (!Array.isArray(body.tests)) return 'Result rejected: tests must be an array';
  if (trainer ? body.tests.length < 1 || body.tests.length > 100 : body.tests.length !== 100) return 'Result rejected: wrong number of checks';
  const seen = new Set();
  for (const t of body.tests) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return 'Result rejected: invalid check entry';
    const keys = Object.keys(t);
    if (keys.length !== 2 || !keys.includes('id') || !keys.includes('status')) return 'Result rejected: invalid check entry';
    if (typeof t.id !== 'string' || !TEST_ID.test(t.id)) return 'Result rejected: invalid check id';
    if (!STATUSES.has(t.status)) return 'Result rejected: invalid check status';
    if (seen.has(t.id)) return 'Result rejected: duplicate check id';
    seen.add(t.id);
  }
  return null;
}

function buildRunDoc(body, req) {
  return {
    runId: body.runId,
    registrationNumber: body.registrationNumber,
    setId: body.setId,
    mode: body.mode,
    seed: body.seed,
    evaluatorVersion: body.evaluatorVersion,
    startedAt: new Date(body.startedAt),
    finishedAt: new Date(body.finishedAt),
    durationMs: body.durationMs,
    serverUrl: body.serverUrl,
    ...computeScores(body.tests),
    tests: body.tests.map((t) => ({ id: t.id, status: t.status })),
    clientIp: req.ip || (req.socket && req.socket.remoteAddress) || '',
    ...(body.deviceId ? { deviceId: body.deviceId } : {}),
    receivedAt: new Date(),
  };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function csvCell(v) {
  if (v === undefined || v === null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseRosterCsv(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (/^reg/i.test(cells[0])) continue; // header
    if (!REG_REGEX.test(cells[0])) continue;
    rows.push({ _id: normalizeReg(cells[0]), name: cells[1] || '', section: cells[2] || '' });
  }
  return rows;
}

function htmlEscape(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const MSG_NOT_ON_ROSTER = 'This registration number is not on the class list. Check it with npm run whoami -- --change, or tell the invigilator.';
const MSG_WRONG_PIN = 'The PIN does not match this registration number. Check your PIN slip and run npm run whoami -- --change.';
const MSG_PIN_LOCKED = 'Too many wrong PINs. Wait 15 minutes, or tell the invigilator.';
const MSG_SECOND_LAPTOP = 'This registration number is already registered on another laptop. Use your own laptop, or tell the invigilator.';
const MSG_LAPTOP_TAKEN = 'This laptop is already registered to another student. Each student must use their own laptop. Tell the invigilator.';
const MSG_SLOT_CLOSED = 'Your assessment slot is closed, so nothing can be submitted for this registration number. Tell the invigilator.';

// A slot the trainer has opened (open: true) is 'scheduled' before its opening time, 'open' until its closing
// time and 'ended' after it; either time may be unset. A slot the trainer has not opened is 'closed'.
function slotState(slot, now = Date.now()) {
  if (!slot || !slot.open) return 'closed';
  if (slot.closesAt && now >= new Date(slot.closesAt).getTime()) return 'ended';
  if (slot.opensAt && now < new Date(slot.opensAt).getTime()) return 'scheduled';
  return 'open';
}
const slotIsOpen = (slot, now = Date.now()) => slotState(slot, now) === 'open';
const MAX_EXTEND_MINUTES = 240;

function createApp({ db, collectorKey, adminPassword, pinSecret, rateLimitMs = 20000 }) {
  if (!collectorKey || !adminPassword || !pinSecret) throw new Error('COLLECTOR_KEY, ADMIN_PASSWORD and PIN_SECRET are required');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const runs = db.collection('runs');
  const students = db.collection('students');
  const trainerRuns = db.collection('trainerRuns');
  const roster = db.collection('roster');
  const slots = db.collection('slots');
  const lastAccepted = new Map();
  const pinLimiter = createPinLimiter();

  // Roster + PIN + laptop check shared by /api/verify-student and /api/results. Returns null when the student
  // is allowed, otherwise { status, message, code }. The first laptop that logs in with the right PIN is bound
  // to the registration number; another laptop for that number, or that laptop for another number, is rejected
  // and logged in laptopConflicts (dashboard). The trainer can reset a binding.
  // Every roster student belongs to a slot (one assessment session); only students of an open slot get in,
  // so a kit picked up after the session (or before the next one) is refused. No slot counts as closed.
  async function checkStudent(req, reg, pin, deviceId) {
    const client = req.ip || (req.socket && req.socket.remoteAddress) || '';
    if (pinLimiter.isLocked(client, reg)) return { status: 429, message: MSG_PIN_LOCKED, code: 'PIN_LOCKED' };
    const student = await roster.findOne({ _id: reg });
    if (!student) return { status: 403, message: MSG_NOT_ON_ROSTER, code: 'NOT_ON_ROSTER' };
    if (!pinMatches(pinSecret, reg, pin)) {
      pinLimiter.fail(client, reg);
      return { status: 403, message: MSG_WRONG_PIN, code: 'WRONG_PIN' };
    }
    pinLimiter.succeed(client, reg);
    if (!slotIsOpen(student.slot && (await slots.findOne({ _id: student.slot })))) return { status: 403, message: MSG_SLOT_CLOSED, code: 'SLOT_CLOSED' };

    const conflict = async (kind, otherReg, code, message) => {
      await laptopConflicts.insertOne({ at: new Date(), registrationNumber: reg, kind, otherRegistrationNumber: otherReg || '', deviceId, clientIp: client });
      return { status: 403, message, code };
    };
    const owner = await roster.findOne({ deviceId, _id: { $ne: reg } }, { projection: { _id: 1 } });
    if (owner) return conflict('laptop already used by another student', owner._id, 'LAPTOP_TAKEN', MSG_LAPTOP_TAKEN);
    if (!student.deviceId) {
      try {
        await roster.updateOne({ _id: reg, deviceId: { $exists: false } }, { $set: { deviceId, deviceBoundAt: new Date(), deviceIp: client } });
      } catch (e) {
        if (e && e.code === 11000) return conflict('laptop already used by another student', '', 'LAPTOP_TAKEN', MSG_LAPTOP_TAKEN);
        throw e;
      }
    }
    const bound = await roster.findOne({ _id: reg }, { projection: { deviceId: 1 } });
    if (bound.deviceId !== deviceId) return conflict('second laptop for this registration number', '', 'SECOND_LAPTOP', MSG_SECOND_LAPTOP);
    return null;
  }

  const jsonBody = express.json({ limit: '200kb' });
  const laptopConflicts = db.collection('laptopConflicts');
  const err = (res, status, message, code) => res.status(status).json(code ? { error: message, code } : { error: message });

  // ---- student kits ------------------------------------------------------------------------
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Used by the kit (npm run whoami / evaluate) to check the registration number and PIN before a run.
  app.post('/api/verify-student', jsonBody, async (req, res, next) => {
    try {
      const key = req.get('x-collector-key');
      if (!key || !safeEqual(key, collectorKey)) return err(res, 401, 'Invalid collector key. Ask the invigilator for a fresh kit.');
      const { registrationNumber, pin, deviceId } = req.body || {};
      if (typeof registrationNumber !== 'string' || !REG_REGEX.test(registrationNumber)) return err(res, 400, 'Invalid registration number');
      if (typeof pin !== 'string' || !PIN_REGEX.test(pin)) return err(res, 400, 'The PIN must be 6 digits');
      if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) return err(res, 400, 'Invalid device id. Ask the invigilator for a fresh kit.');
      const reg = normalizeReg(registrationNumber);
      const problem = await checkStudent(req, reg, pin, deviceId);
      if (problem) return err(res, problem.status, problem.message, problem.code);
      const student = await roster.findOne({ _id: reg });
      res.json({ ok: true, name: student.name || '' });
    } catch (e) {
      next(e);
    }
  });

  app.post('/api/results', jsonBody, async (req, res, next) => {
    try {
      const key = req.get('x-collector-key');
      if (!key || !safeEqual(key, collectorKey)) return err(res, 401, 'Result rejected: invalid collector key. Ask the invigilator for a fresh kit.');
      const body = req.body;
      const shape = validateShape(body, false);
      if (shape) return err(res, 400, shape);
      if (body.mode !== 'assessment') return err(res, 400, 'Result rejected: only assessment runs are accepted here');
      if (!verifyChecksum(collectorKey, body)) return err(res, 400, 'Result rejected: checksum does not match');
      const problem = await checkStudent(req, body.registrationNumber, body.pin, body.deviceId);
      if (problem) return err(res, problem.status, problem.message, problem.code);

      if (await runs.findOne({ runId: body.runId }, { projection: { _id: 1 } })) return res.json({ ok: true });

      const reg = body.registrationNumber;
      const last = lastAccepted.get(reg);
      if (last && Date.now() - last < rateLimitMs) {
        return err(res, 429, `Too many submissions. Wait ${Math.ceil(rateLimitMs / 1000)} seconds and run the kit again.`);
      }
      try {
        await runs.insertOne(buildRunDoc(body, req));
      } catch (e) {
        if (e && e.code === 11000) return res.json({ ok: true });
        throw e;
      }
      lastAccepted.set(reg, Date.now());
      // the student's set is the one they entered in the kit (the set of their latest run)
      await rebuildStudent(db, reg);
      // never return score, best score or attempts to the kit
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---- trainer / admin ---------------------------------------------------------------------
  const adminAuth = (req, res, next) => {
    const h = req.get('authorization') || '';
    const m = h.match(/^Basic\s+(.+)$/i);
    if (m) {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(password, adminPassword)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Assessment admin", charset="UTF-8"');
    return err(res, 401, 'admin password required');
  };
  app.use('/admin', adminAuth);
  app.get('/admin', (req, res, next) => (req.originalUrl.endsWith('/') ? next() : res.redirect('/admin/')));
  app.use('/admin', express.static(path.join(__dirname, 'admin'), { index: 'index.html' }));

  app.post('/admin/api/trainer-runs', jsonBody, async (req, res, next) => {
    try {
      const body = req.body;
      const shape = validateShape(body, true);
      if (shape) return err(res, 400, shape);
      if (body.mode !== 'trainer') return err(res, 400, 'Result rejected: mode must be "trainer" on this route');
      if (!verifyChecksum(collectorKey, body)) return err(res, 400, 'Result rejected: checksum does not match');
      if (await trainerRuns.findOne({ runId: body.runId }, { projection: { _id: 1 } })) {
        const existing = await trainerRuns.findOne({ runId: body.runId });
        return res.json({ ok: true, score: existing.score });
      }
      const doc = { ...buildRunDoc(body, req), note: body.note || '' };
      await trainerRuns.insertOne(doc);
      res.json({ ok: true, score: doc.score, passed: doc.passed, failed: doc.failed, blocked: doc.blocked });
    } catch (e) {
      next(e);
    }
  });

  async function studentRows() {
    const [list, names] = await Promise.all([students.find({}).toArray(), roster.find({}).toArray()]);
    const byReg = new Map(names.map((r) => [r._id, r]));
    return list.map((s) => ({
      registrationNumber: s._id,
      name: (byReg.get(s._id) || {}).name || '',
      section: (byReg.get(s._id) || {}).section || '',
      slot: (byReg.get(s._id) || {}).slot || '',
      assignedSet: s.assignedSet,
      ...s.assessment,
    }));
  }

  app.get('/admin/api/students', async (req, res, next) => {
    try {
      res.json(await studentRows());
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/students/:reg', async (req, res, next) => {
    try {
      const reg = normalizeReg(req.params.reg);
      const [student, studentRuns, reruns, enrolled] = await Promise.all([
        students.findOne({ _id: reg }),
        runs.find({ registrationNumber: reg }, { projection: { tests: 0 } }).sort({ receivedAt: -1 }).toArray(),
        trainerRuns.find({ registrationNumber: reg }, { projection: { tests: 0 } }).sort({ receivedAt: -1 }).toArray(),
        roster.findOne({ _id: reg }),
      ]);
      const laptop = enrolled && enrolled.deviceId ? { deviceId: enrolled.deviceId, boundAt: enrolled.deviceBoundAt, ip: enrolled.deviceIp } : null;
      res.json({ student, runs: studentRuns, trainerRuns: reruns, laptop });
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/runs/:runId', async (req, res, next) => {
    try {
      const doc = (await runs.findOne({ runId: req.params.runId })) || (await trainerRuns.findOne({ runId: req.params.runId }));
      if (!doc) return err(res, 404, 'no such run');
      res.json(doc);
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/trainer-runs', async (req, res, next) => {
    try {
      res.json(await trainerRuns.find({}, { projection: { tests: 0 } }).sort({ receivedAt: -1 }).limit(1000).toArray());
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/summary', async (req, res, next) => {
    try {
      const list = await students.find({}).toArray();
      const best = list.map((s) => (s.assessment ? s.assessment.best : 0));
      const distribution = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: 0 }));
      for (const b of best) distribution[Math.min(9, Math.floor(b / 10))].count++;
      res.json({
        started: list.length,
        averageBest: list.length ? Math.round((best.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : 0,
        perfect: best.filter((b) => b === 100).length,
        distribution,
        rosterSize: await roster.countDocuments(),
      });
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/not-started', async (req, res, next) => {
    try {
      const started = new Set((await students.find({}, { projection: { _id: 1 } }).toArray()).map((s) => s._id));
      const all = await roster.find({}).sort({ _id: 1 }).toArray();
      res.json(all.filter((r) => !started.has(r._id)).map((r) => ({ registrationNumber: r._id, name: r.name, section: r.section, slot: r.slot || '' })));
    } catch (e) {
      next(e);
    }
  });

  app.post('/admin/api/roster', express.text({ type: () => true, limit: '1mb' }), async (req, res, next) => {
    try {
      const slot = String(req.query.slot || '').trim();
      if (!SLOT_NAME.test(slot)) return err(res, 400, 'a slot name is required (letters, digits, . _ -), for example sist-15-10-26-fn');
      const rows = parseRosterCsv(req.body);
      if (!rows.length) return err(res, 400, 'no valid rows (expected CSV: reg,name,section)');
      // update name/section/slot only, so a re-upload keeps each student's laptop binding
      await roster.bulkWrite(rows.map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { name: r.name, section: r.section, slot } }, upsert: true } })));
      // a new slot starts closed: the trainer opens it when the session starts
      await slots.updateOne({ _id: slot }, { $setOnInsert: { open: false, opensAt: null, closesAt: null, createdAt: new Date() } }, { upsert: true });
      res.json({ ok: true, imported: rows.length, slot });
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/export.csv', async (req, res, next) => {
    try {
      const rows = (await studentRows()).sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber));
      const header = ['registrationNumber', 'name', 'section', 'slot', 'assignedSet', 'best', 'latest', 'attempts', ...GROUP_KEYS.map((g) => `best_${g}`), 'lastRunAt'];
      const lines = [header.join(',')];
      for (const r of rows) {
        const g = r.bestGroupScores || {};
        lines.push([r.registrationNumber, r.name, r.section, r.slot, r.assignedSet, r.best, r.latest, r.attempts, ...GROUP_KEYS.map((k) => g[k]), r.lastRunAt].map(csvCell).join(','));
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="assessment-results-${stamp}.csv"`);
      res.send('﻿' + lines.join('\r\n') + '\r\n'); // BOM so Excel reads UTF-8
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/slots', async (req, res, next) => {
    try {
      const [list, enrolled, started] = await Promise.all([
        slots.find({}).sort({ _id: 1 }).toArray(),
        roster.find({}, { projection: { slot: 1 } }).toArray(),
        students.find({}, { projection: { _id: 1 } }).toArray(),
      ]);
      const startedSet = new Set(started.map((s) => s._id));
      const counts = new Map();
      for (const r of enrolled) {
        const c = counts.get(r.slot || '') || { students: 0, started: 0 };
        c.students++;
        if (startedSet.has(r._id)) c.started++;
        counts.set(r.slot || '', c);
      }
      const now = Date.now();
      const rows = list.map((s) => ({ slot: s._id, state: slotState(s, now), opensAt: s.opensAt || null, closesAt: s.closesAt || null, ...(counts.get(s._id) || { students: 0, started: 0 }) }));
      if (counts.has('')) rows.push({ slot: '', state: 'closed', opensAt: null, closesAt: null, ...counts.get('') });
      // the server's clock, so the dashboard counts down to the same moment the server enforces
      res.json({ now: new Date(now), slots: rows });
    } catch (e) {
      next(e);
    }
  });

  // body: { open: true|false, opensAt?: ISO string or null, closesAt?: ISO string or null }
  // open: true with no opensAt opens at once; open: false closes at once and clears both times.
  app.post('/admin/api/slots/:slot', jsonBody, async (req, res, next) => {
    try {
      const { open, opensAt = null, closesAt = null } = req.body || {};
      if (typeof open !== 'boolean') return err(res, 400, 'open must be true or false');
      for (const [k, v] of Object.entries({ opensAt, closesAt })) if (v !== null && !isIso(v)) return err(res, 400, `${k} must be a date-time or null`);
      const set = { open, opensAt: null, closesAt: null, updatedAt: new Date() };
      if (open) {
        set.opensAt = opensAt ? new Date(opensAt) : null;
        set.closesAt = closesAt ? new Date(closesAt) : null;
        if (set.closesAt && set.closesAt.getTime() <= Date.now()) return err(res, 400, 'The closing time has already passed. Pick a later time.');
        if (set.opensAt && set.closesAt && set.opensAt >= set.closesAt) return err(res, 400, 'The closing time must be after the opening time.');
      }
      const r = await slots.updateOne({ _id: req.params.slot }, { $set: set });
      if (!r.matchedCount) return err(res, 404, 'no such slot (upload a roster for it first)');
      const doc = await slots.findOne({ _id: req.params.slot });
      res.json({ ok: true, state: slotState(doc), opensAt: doc.opensAt, closesAt: doc.closesAt });
    } catch (e) {
      next(e);
    }
  });

  // body: { minutes }. Moves the closing time later (from now, if it has already passed, which reopens the slot).
  app.post('/admin/api/slots/:slot/extend', jsonBody, async (req, res, next) => {
    try {
      const minutes = (req.body || {}).minutes;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EXTEND_MINUTES) return err(res, 400, `minutes must be a whole number from 1 to ${MAX_EXTEND_MINUTES}`);
      const doc = await slots.findOne({ _id: req.params.slot });
      if (!doc) return err(res, 404, 'no such slot (upload a roster for it first)');
      if (!doc.open || !doc.closesAt) return err(res, 400, 'Only a slot that is open with a closing time can be extended.');
      const closesAt = new Date(Math.max(new Date(doc.closesAt).getTime(), Date.now()) + minutes * 60000);
      await slots.updateOne({ _id: doc._id }, { $set: { closesAt, updatedAt: new Date() } });
      res.json({ ok: true, state: slotState({ ...doc, closesAt }), opensAt: doc.opensAt || null, closesAt });
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/laptop-conflicts', async (req, res, next) => {
    try {
      res.json(await laptopConflicts.find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(500).toArray());
    } catch (e) {
      next(e);
    }
  });

  app.post('/admin/api/students/:reg/reset-laptop', async (req, res, next) => {
    try {
      const reg = normalizeReg(req.params.reg);
      const r = await roster.updateOne({ _id: reg }, { $unset: { deviceId: '', deviceBoundAt: '', deviceIp: '' } });
      if (!r.matchedCount) return err(res, 404, 'not on the roster');
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // Frees a laptop from whichever student it is bound to (from a Laptop conflicts row; that student may have no runs yet)
  app.post('/admin/api/laptops/:deviceId/reset', async (req, res, next) => {
    try {
      const deviceId = String(req.params.deviceId);
      if (!DEVICE_ID.test(deviceId)) return err(res, 400, 'invalid laptop id');
      const owner = await roster.findOne({ deviceId }, { projection: { _id: 1 } });
      if (!owner) return res.json({ ok: true, registrationNumber: null });
      await roster.updateOne({ _id: owner._id, deviceId }, { $unset: { deviceId: '', deviceBoundAt: '', deviceIp: '' } });
      res.json({ ok: true, registrationNumber: owner._id });
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/pins.csv', async (req, res, next) => {
    try {
      const all = await roster.find(req.query.slot ? { slot: String(req.query.slot) } : {}).sort({ _id: 1 }).toArray();
      const lines = ['registrationNumber,name,section,pin', ...all.map((r) => [r._id, r.name, r.section, pinFor(pinSecret, r._id)].map(csvCell).join(','))];
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="pin-slips.csv"');
      res.send('\ufeff' + lines.join('\r\n') + '\r\n');
    } catch (e) {
      next(e);
    }
  });

  app.get('/admin/api/pin-slips', async (req, res, next) => {
    try {
      const all = await roster.find(req.query.slot ? { slot: String(req.query.slot) } : {}).sort({ section: 1, _id: 1 }).toArray();
      const slips = all
        .map((r) => `<div class="slip"><div class="t">Assessment kit login</div><div><b>Registration number:</b> ${htmlEscape(r._id)}</div>` +
          `<div><b>Name:</b> ${htmlEscape(r.name)}${r.section ? ` &nbsp; <b>Section:</b> ${htmlEscape(r.section)}` : ''}</div>` +
          `<div class="pin">PIN: ${pinFor(pinSecret, r._id)}</div><div class="n">Enter both in npm run whoami, on your own laptop: the first laptop you log in from is registered to you.<br>` +
          `<b>Your PIN is personal. If it is used by anyone else, both students get zero for this assessment.</b></div></div>`)
        .join('');
      res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>PIN slips</title><style>
body{font-family:system-ui,sans-serif;margin:16px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.slip{border:1px dashed #555;padding:10px 12px;break-inside:avoid;font-size:14px;line-height:1.5}.t{font-weight:600;margin-bottom:4px}
.pin{font-size:22px;font-family:ui-monospace,monospace;letter-spacing:2px;margin:6px 0}.n{font-size:12px;color:#444}
@media print{.noprint{display:none}body{margin:0}}</style></head><body>
<p class="noprint">${all.length} slips. Print this page and cut along the dashed lines.${all.length ? '' : ' Upload a roster CSV first.'}</p>
<div class="grid">${slips}</div></body></html>`);
    } catch (e) {
      next(e);
    }
  });

  app.delete('/admin/api/runs/:runId', async (req, res, next) => {
    try {
      const doc = await runs.findOne({ runId: req.params.runId });
      if (doc) {
        await runs.deleteOne({ runId: doc.runId });
        await rebuildStudent(db, doc.registrationNumber);
        return res.json({ ok: true, deleted: 'run' });
      }
      const t = await trainerRuns.deleteOne({ runId: req.params.runId });
      if (t.deletedCount) return res.json({ ok: true, deleted: 'trainerRun' });
      err(res, 404, 'no such run');
    } catch (e) {
      next(e);
    }
  });

  // ---- students of one slot: list, add (one or many), remove ----
  app.get('/admin/api/slots/:slot/students', async (req, res, next) => {
    try {
      const [doc, list] = await Promise.all([slots.findOne({ _id: req.params.slot }), roster.find({ slot: req.params.slot }).sort({ _id: 1 }).toArray()]);
      if (!doc && !list.length) return err(res, 404, 'no such slot');
      const summaries = new Map((await students.find({ _id: { $in: list.map((r) => r._id) } }).toArray()).map((s) => [s._id, s]));
      res.json(
        list.map((r) => {
          const a = (summaries.get(r._id) || {}).assessment;
          return { registrationNumber: r._id, name: r.name || '', section: r.section || '', laptop: Boolean(r.deviceId), attempts: a ? a.attempts : 0, best: a ? a.best : null };
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  // body: { students: [{ registrationNumber, name?, section? }] } (up to 1000). A student already in another slot is
  // moved to this one, as a roster upload does; the laptop binding is kept. A new slot starts closed.
  app.post('/admin/api/slots/:slot/students', jsonBody, async (req, res, next) => {
    try {
      const slot = req.params.slot;
      if (!SLOT_NAME.test(slot)) return err(res, 400, 'a slot name is required (letters, digits, . _ -), for example sist-15-10-26-fn');
      const list = req.body && req.body.students;
      if (!Array.isArray(list) || !list.length || list.length > 1000) return err(res, 400, 'students must be a list of 1 to 1000 entries');
      const rows = new Map();
      for (const s of list) {
        const text = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
        const reg = s && typeof s.registrationNumber === 'string' ? s.registrationNumber.trim() : '';
        if (!REG_REGEX.test(reg)) return err(res, 400, `invalid registration number "${String(reg).slice(0, 30)}" (4 to 20 letters, digits, . _ / -)`);
        rows.set(normalizeReg(reg), { _id: normalizeReg(reg), name: text(s.name), section: text(s.section) });
      }
      const before = await roster.find({ _id: { $in: [...rows.keys()] } }, { projection: { slot: 1 } }).toArray();
      const moved = before.filter((r) => r.slot && r.slot !== slot).map((r) => ({ registrationNumber: r._id, from: r.slot }));
      await roster.bulkWrite([...rows.values()].map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { name: r.name, section: r.section, slot } }, upsert: true } })));
      await slots.updateOne({ _id: slot }, { $setOnInsert: { open: false, opensAt: null, closesAt: null, createdAt: new Date() } }, { upsert: true });
      res.json({ ok: true, slot, added: rows.size - before.length, updated: before.length - moved.length, moved });
    } catch (e) {
      next(e);
    }
  });

  // body: { registrationNumbers: [...], deleteRuns?: boolean }. Takes the students off the roster (they can no longer
  // log in or submit, and their laptop binding goes). Their runs stay unless deleteRuns is true.
  app.post('/admin/api/slots/:slot/students/remove', jsonBody, async (req, res, next) => {
    try {
      const { registrationNumbers, deleteRuns = false } = req.body || {};
      if (!Array.isArray(registrationNumbers) || !registrationNumbers.length || registrationNumbers.some((r) => typeof r !== 'string')) {
        return err(res, 400, 'registrationNumbers must be a non-empty list');
      }
      if (typeof deleteRuns !== 'boolean') return err(res, 400, 'deleteRuns must be true or false');
      const regs = (await roster.find({ _id: { $in: registrationNumbers.map(normalizeReg) }, slot: req.params.slot }, { projection: { _id: 1 } }).toArray()).map((r) => r._id);
      await roster.deleteMany({ _id: { $in: regs }, slot: req.params.slot });
      let deletedRuns = 0;
      if (deleteRuns && regs.length) {
        deletedRuns = (await runs.deleteMany({ registrationNumber: { $in: regs } })).deletedCount;
        await trainerRuns.deleteMany({ registrationNumber: { $in: regs } });
        await students.deleteMany({ _id: { $in: regs } });
        regs.forEach((r) => lastAccepted.delete(r));
      }
      res.json({ ok: true, removed: regs.length, deletedRuns });
    } catch (e) {
      next(e);
    }
  });

  // Deletes every assessment run of a student (and, with ?trainer=1, the trainer re-runs) and clears their summary.
  // The student stays on the roster with their laptop binding, so they can still sit the assessment.
  app.delete('/admin/api/students/:reg/runs', async (req, res, next) => {
    try {
      const reg = normalizeReg(req.params.reg);
      const r = await runs.deleteMany({ registrationNumber: reg });
      const t = req.query.trainer === '1' ? (await trainerRuns.deleteMany({ registrationNumber: reg })).deletedCount : 0;
      await students.deleteOne({ _id: reg });
      lastAccepted.delete(reg);
      res.json({ ok: true, deletedRuns: r.deletedCount, deletedTrainerRuns: t });
    } catch (e) {
      next(e);
    }
  });

  app.delete('/admin/api/students/:reg', async (req, res, next) => {
    try {
      const reg = normalizeReg(req.params.reg);
      const r = await runs.deleteMany({ registrationNumber: reg });
      await students.deleteOne({ _id: reg });
      lastAccepted.delete(reg);
      res.json({ ok: true, deletedRuns: r.deletedCount });
    } catch (e) {
      next(e);
    }
  });

  app.use((req, res) => err(res, 404, 'not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((e, req, res, next) => {
    if (e && e.type === 'entity.parse.failed') return err(res, 400, 'Result rejected: body is not valid JSON');
    if (e && e.type === 'entity.too.large') return err(res, 413, 'Result rejected: body too large');
    console.error(e);
    err(res, 500, 'collector error');
  });
  return app;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const { connect } = require('./db');
  const { MONGODB_URI, DB_NAME = 'webdev_assessment', COLLECTOR_KEY, ADMIN_PASSWORD, PIN_SECRET } = process.env;
  const port = Number(process.env.PORT) || 4000;
  for (const [k, v] of Object.entries({ MONGODB_URI, COLLECTOR_KEY, ADMIN_PASSWORD, PIN_SECRET })) {
    if (!v) {
      console.error(`${k} is missing from collector/.env (copy .env.example).`);
      process.exit(1);
    }
  }
  const { db } = await connect(MONGODB_URI, DB_NAME);
  const app = createApp({ db, collectorKey: COLLECTOR_KEY, adminPassword: ADMIN_PASSWORD, pinSecret: PIN_SECRET });
  app.listen(port, '0.0.0.0', () => {
    const ips = lanAddresses();
    const ip = ips[0] || 'localhost';
    console.log('=================================================');
    console.log(`  Students submit to: http://${ip}:${port}`);
    console.log(`  Admin dashboard:    http://${ip}:${port}/admin`);
    console.log('=================================================');
    if (ips.length > 1) console.log(`  (other addresses on this laptop: ${ips.slice(1).join(', ')})`);
    console.log(`  Database: ${DB_NAME}`);
  });
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`Collector could not start: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { createApp, verifyChecksum, checksumInput, validateShape, parseRosterCsv };
