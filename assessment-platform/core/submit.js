'use strict';
// Builds the result document, signs it, POSTs it to the collector and keeps a pending queue
// for results that could not be delivered.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { request } = require('./http');
const { EVALUATOR_VERSION } = require('./version');

function checksumInput(doc) {
  const passed = doc.tests.filter((t) => t.status === 'PASS').map((t) => t.id).sort();
  return [doc.registrationNumber, doc.setId, doc.mode, doc.seed, passed.join(','), doc.evaluatorVersion].join('|');
}

function computeChecksum(key, doc) {
  return crypto.createHmac('sha256', String(key)).update(checksumInput(doc)).digest('hex');
}

function buildResultDoc({ run, registrationNumber, mode, key, extra }) {
  const doc = {
    runId: crypto.randomUUID(),
    registrationNumber,
    setId: run.setId,
    mode,
    seed: run.seed,
    evaluatorVersion: EVALUATOR_VERSION,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    serverUrl: run.serverUrl,
    tests: run.results.map((r) => ({ id: r.id, status: r.status })),
    ...(extra || {}),
  };
  doc.checksum = computeChecksum(key, doc);
  return doc;
}

// kind: 'ok' (2xx), 'rejected' (4xx, final), 'unreachable' (network error or 5xx)
async function postResult(url, doc, headers) {
  const res = await request('POST', url, { body: doc, headers, timeoutMs: 15000 });
  if (res.status >= 200 && res.status < 300) return { kind: 'ok', status: res.status, body: res.json };
  if (res.status >= 400 && res.status < 500) {
    const j = res.json || {};
    const message = (typeof j.error === 'string' && j.error) || (typeof j.message === 'string' && j.message) || `The collector refused the result (HTTP ${res.status}).`;
    return { kind: 'rejected', status: res.status, message, code: typeof j.code === 'string' ? j.code : undefined };
  }
  return { kind: 'unreachable', status: res.status, message: res.error || `HTTP ${res.status}` };
}

// The pending queue is AES-256-GCM encrypted with a key derived from the collector key that
// ships inside the kit. This is a deterrent against casual reading, not security: anyone who
// reads the kit source can decrypt it.
function encryptPending(collectorKey, doc) {
  const key = crypto.createHash('sha256').update(String(collectorKey)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decryptPending(collectorKey, text) {
  const buf = Buffer.from(String(text).trim(), 'base64');
  const key = crypto.createHash('sha256').update(String(collectorKey)).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'));
}

function savePending(dir, collectorKey, doc) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${doc.runId}.json`);
  fs.writeFileSync(file, encryptPending(collectorKey, doc));
  return file;
}

function listPending(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f));
}

// tries every pending file; returns [{ runId, kind, message }]
async function submitPending(dir, collectorUrl, collectorKey) {
  const out = [];
  for (const file of listPending(dir)) {
    let doc;
    try {
      doc = decryptPending(collectorKey, fs.readFileSync(file, 'utf8'));
    } catch {
      out.push({ runId: path.basename(file, '.json'), kind: 'unreadable', file });
      continue;
    }
    const r = await postResult(`${collectorUrl.replace(/\/+$/, '')}/api/results`, doc, { 'x-collector-key': collectorKey });
    if (r.kind !== 'unreachable') fs.unlinkSync(file);
    out.push({ runId: doc.runId, kind: r.kind, message: r.message });
  }
  return out;
}

module.exports = { checksumInput, computeChecksum, buildResultDoc, postResult, encryptPending, decryptPending, savePending, listPending, submitPending };
