'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildResultDoc, computeChecksum, encryptPending, decryptPending } = require('../core/submit');
const { verifyChecksum } = require('../collector/server');

const run = {
  setId: 'A6',
  seed: 1234567890,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: 41230,
  serverUrl: 'http://localhost:8080',
  results: [
    { id: 'C02', status: 'PASS' },
    { id: 'C01', status: 'PASS' },
    { id: 'R01', status: 'FAIL' },
    { id: 'L01', status: 'BLOCKED' },
  ],
};

test('checksum round-trip between the kit and the collector', () => {
  const doc = buildResultDoc({ run, registrationNumber: '22CS001', mode: 'assessment', key: 'k1' });
  assert.ok(verifyChecksum('k1', doc));
  assert.ok(!verifyChecksum('k2', doc));
  assert.equal(doc.checksum, computeChecksum('k1', doc));
  for (const change of [
    (d) => (d.tests[2].status = 'PASS'),
    (d) => (d.registrationNumber = '22CS002'),
    (d) => (d.setId = 'A7'),
    (d) => (d.mode = 'trainer'),
    (d) => (d.seed = 1),
    (d) => (d.evaluatorVersion = '9.9.9'),
  ]) {
    const copy = structuredClone(doc);
    change(copy);
    assert.ok(!verifyChecksum('k1', copy));
  }
  // order of tests does not matter (passed ids are sorted)
  const reordered = structuredClone(doc);
  reordered.tests.reverse();
  assert.ok(verifyChecksum('k1', reordered));
});

test('pending blob is not plain JSON and decrypts back', () => {
  const doc = buildResultDoc({ run, registrationNumber: '22CS001', mode: 'assessment', key: 'k1' });
  const blob = encryptPending('k1', doc);
  assert.throws(() => JSON.parse(blob));
  assert.doesNotMatch(blob, /PASS|FAIL|score|22CS001/);
  assert.deepEqual(decryptPending('k1', blob), doc);
  assert.throws(() => decryptPending('wrong', blob));
});
