'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeRng } = require('../core/rng');
const { createGenerator, fieldNames, POOLS, NO_MATCH, SEED_COUNT } = require('../core/generator');

const DOMAINS = path.join(__dirname, '..', 'domains');
const configs = fs.readdirSync(DOMAINS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DOMAINS, f), 'utf8')));

test('word pools: no word contains another word, none contains the no-match term', () => {
  const all = [...new Set(Object.values(POOLS).flat())];
  for (const a of all) {
    assert.ok(!a.includes(NO_MATCH));
    for (const b of all) if (a !== b) assert.ok(!a.includes(b), `"${a}" contains "${b}"`);
  }
});

const hasToken = (text, word) => text.toLowerCase().split(' ').includes(word.toLowerCase());

function checkInvariants(cfg, seed) {
  const F = fieldNames(cfg);
  const gen = createGenerator(cfg, makeRng(seed));
  const recs = gen.seeds;
  const { shared, mixed, text2Only } = gen.special;
  const where = `${cfg.setId} seed ${seed}`;
  assert.equal(recs.length, SEED_COUNT, where);

  // 1 + 7: characters, lengths, no padding
  for (const r of recs) {
    for (const [f, spec] of [[F.text1, cfg.text1], [F.text2, cfg.text2]]) {
      assert.match(r[f], /^[A-Za-z0-9 ]+$/, `${where}: ${f} "${r[f]}"`);
      assert.equal(r[f], r[f].trim(), where);
      assert.ok(r[f].length >= spec.minLen && r[f].length <= spec.maxLen, `${where}: ${f} length ${r[f].length}`);
    }
  }
  assert.equal(new Set(recs.map((r) => r[F.text1].toLowerCase())).size, recs.length, `${where}: text1 values unique`);

  // 2: deliberate overlap
  const sharedCount = recs.filter((r) => hasToken(r[F.text1], shared)).length;
  assert.ok(sharedCount >= 4 && sharedCount <= 12, `${where}: shared word in ${sharedCount} records`);
  assert.ok(recs.every((r) => !r[F.text1].toLowerCase().includes(text2Only)), `${where}: text2-only word found in text1`);
  assert.ok(recs.filter((r) => hasToken(r[F.text2], text2Only)).length >= 3, `${where}: text2-only word count`);
  const mixedForms = recs.flatMap((r) => r[F.text1].split(' ').filter((w) => w.toLowerCase() === mixed));
  assert.ok(mixedForms.length >= 3, where);
  for (const form of [mixed, mixed.toUpperCase(), mixed[0].toUpperCase() + mixed.slice(1)]) assert.ok(mixedForms.includes(form), `${where}: missing form ${form}`);
  for (const r of recs) for (const f of [F.text1, F.text2]) assert.ok(!r[f].toLowerCase().includes(NO_MATCH), where);

  // 3: initial-letter case mix that makes a case-sensitive sort differ
  const upper = recs.filter((r) => /^[A-Z]/.test(r[F.text1])).length;
  const lower = recs.filter((r) => /^[a-z]/.test(r[F.text1])).length;
  assert.ok(upper >= 6 && lower >= 6, `${where}: ${upper} upper / ${lower} lower`);
  const t1 = recs.map((r) => r[F.text1]);
  const cs = t1.slice().sort();
  const ci = t1.slice().sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  assert.notDeepEqual(cs, ci, `${where}: case-sensitive sort equals case-insensitive sort`);

  // 4: enum and flag coverage
  for (const v of cfg.enum.values) assert.ok(recs.filter((r) => r[F.enum] === v).length >= 4, `${where}: enum ${v}`);
  assert.ok(recs.filter((r) => r[F.flag] === true).length >= 10, where);
  assert.ok(recs.filter((r) => r[F.flag] === false).length >= 10, where);

  // 5: amounts and counts
  const scale = 10 ** cfg.amount.genDecimals;
  const amounts = recs.map((r) => r[F.amount]);
  for (const a of amounts) {
    assert.ok(typeof a === 'number' && a >= cfg.amount.genMin && a <= cfg.amount.max, `${where}: amount ${a}`);
    assert.ok(Math.abs(a * scale - Math.round(a * scale)) < 1e-6, `${where}: amount ${a} has too many decimals`);
  }
  const freq = new Map();
  for (const a of amounts) freq.set(a, (freq.get(a) || 0) + 1);
  assert.ok([...freq.values()].some((n) => n >= 3), `${where}: no amount used 3 times`);
  assert.ok(freq.size >= 12, `${where}: ${freq.size} distinct amounts`);
  if (cfg.amount.max >= 10) {
    const textOrder = amounts.slice().sort((a, b) => (String(a) < String(b) ? -1 : 1));
    assert.notDeepEqual(textOrder, amounts.slice().sort((a, b) => a - b), `${where}: text sort of amounts equals numeric sort`);
  }
  const counts = recs.map((r) => r[F.count]);
  assert.ok(counts.every((c) => Number.isInteger(c) && c >= cfg.count.min && c <= cfg.count.max), where);
  assert.ok(counts.includes(cfg.count.min), `${where}: count minimum missing`);

  // 6: unique codes
  if (F.code) {
    const codes = recs.map((r) => r[F.code]);
    assert.equal(new Set(codes.map((c) => c.toLowerCase())).size, codes.length, where);
    for (const c of codes) assert.ok(c.length >= cfg.uniqueCode.minLen && c.length <= cfg.uniqueCode.maxLen, `${where}: code ${c}`);
    assert.ok(codes.every((c) => c.toLowerCase() !== c), `${where}: codes need letters so case can be toggled`);
  }
}

for (const cfg of configs) {
  test(`generator invariants hold for ${cfg.setId} over 200 seeds`, () => {
    for (let i = 0; i < 200; i++) checkInvariants(cfg, (i * 2654435761) >>> 0);
  });
}

test('same seed gives the same dataset', () => {
  const cfg = configs[0];
  const a = createGenerator(cfg, makeRng(42)).seeds;
  const b = createGenerator(cfg, makeRng(42)).seeds;
  assert.deepEqual(a, b);
});
