'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const core = require('../core/assign');
const collector = require('../collector/assign');

for (const [name, impl] of [['core', core], ['collector', collector]]) {
  test(`${name}/assign.js normalizes registration numbers and sets`, () => {
    assert.equal(impl.normalizeReg('22cs002 '), '22CS002');
    assert.equal(impl.normalizeReg('SIET2026-017'), 'SIET2026-017');
    assert.equal(impl.normalizeSet(' a5 '), 'A5');
  });
}

test('core and collector assign.js have identical code', () => {
  const strip = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').split('\n').filter((l) => !l.startsWith('//')).join('\n');
  assert.equal(strip('core/assign.js'), strip('collector/assign.js'));
});

test('registration number format', () => {
  for (const ok of ['22CS001', 'SIET2026-017', 'ab.c/d_e', ' 21IT145 ']) assert.ok(core.isValidReg(ok), ok);
  for (const bad of ['abc', 'has space1', 'x'.repeat(21), 'reg#1234', '']) assert.ok(!core.isValidReg(bad), bad);
});

test('set format: only assessment sets A1-A8', () => {
  for (const ok of ['A1', 'A8', 'a5', ' A3 ']) assert.ok(core.isValidSet(ok), ok);
  for (const bad of ['A0', 'A9', 'P1', 'P2', 'A', 'A10', 'B1', '']) assert.ok(!core.isValidSet(bad), bad);
});
