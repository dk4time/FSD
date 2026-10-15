'use strict';
// npm run verify -- --set P1
// 1. reference (no mutant) must score 100/100 with zero BLOCKED on three seeds
// 2. every applicable mutant must FAIL every test in its "must FAIL" list (and score < 100)
// 3. the evaluator must ABORT on a non-empty server and when nothing is listening
const { runSet, summarize } = require('../core/engine');
const { randomSeed } = require('../core/rng');
const { request } = require('../core/http');
const { loadSet, parseArgs } = require('./domains');
const { startReference, freePort } = require('./refproc');
const { MUTANTS } = require('./reference/server');

const MUST_FAIL = {
  M01: 'C06 C07 C08 C09 C10 C11 C12 U05 U06 P05 P06',
  M02: 'C01',
  M03: 'U07',
  M04: 'P02',
  M05: 'D01 D02',
  M06: 'D03 D06 D08',
  M07: 'G02 G06',
  M08: 'G11',
  M09: 'S02',
  M10: 'S03',
  M11: 'F07',
  M12: 'O01 O02',
  M13: 'O03',
  M14: 'L06 G05',
  M15: 'L04 L05',
  M16: 'C13',
  M17: 'H02 R05',
  M18: 'C03',
  M19: 'P08',
  M20: 'U09 P09',
  M21: 'C14 U10 P10',
  M22: 'C14 U10 P10',
  M23: 'C14',
  M24: 'P04',
  M25: 'C08',
  M26: 'G08 G09',
  M27: 'F04',
  M28: 'G05',
  M29: 'O02',
  M30: 'X01 X03',
  M31: 'L08',
};

function applicable(cfg) {
  return Object.keys(MUTANTS).filter((m) => {
    if (m === 'M21' || m === 'M22') return !!cfg.uniqueCode;
    if (m === 'M23') return !cfg.uniqueCode;
    return true;
  });
}

async function runAgainst(cfg, mutant, seed) {
  const ref = await startReference(cfg.setId, mutant);
  try {
    return await runSet({ config: cfg, url: ref.url, seed, waitSeconds: 10 });
  } finally {
    await ref.stop();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.set) {
    console.error('Usage: npm run verify -- --set P1');
    process.exit(1);
  }
  const cfg = loadSet(args.set);
  const violations = [];
  console.log(`Verifying set ${cfg.setId} - ${cfg.title}\n`);

  // 1. reference on three seeds
  const seeds = args.seed ? [Number(args.seed)] : [randomSeed(), randomSeed(), randomSeed()];
  while (seeds.length < 3) seeds.push(randomSeed());
  for (const seed of seeds) {
    const run = await runAgainst(cfg, '', seed);
    if (run.status !== 'COMPLETED') {
      violations.push(`reference seed ${seed}: ABORTED (${run.abortReason})`);
      console.log(`reference  seed ${String(seed).padEnd(10)}  ABORTED`);
      continue;
    }
    const s = summarize(run.results);
    const bad = run.results.filter((r) => r.status !== 'PASS');
    console.log(`reference  seed ${String(seed).padEnd(10)}  ${s.score}/100  blocked ${s.blocked}  (${run.durationMs} ms)`);
    if (s.score !== 100 || s.blocked !== 0) {
      violations.push(`reference seed ${seed}: ${s.score}/100, blocked ${s.blocked}`);
      for (const r of bad) console.log(`    ${r.status} ${r.id} ${r.name}\n      sent: ${r.detail.request}\n      expected: ${r.detail.expected}\n      got: ${r.detail.actual}`);
    }
  }

  // 2. mutants
  console.log('\nMutant matrix (* = required failure, + = extra failure):');
  const list = applicable(cfg);
  let caught = 0;
  for (const m of list) {
    const seed = randomSeed();
    let run;
    try {
      run = await runAgainst(cfg, m, seed);
    } catch (err) {
      violations.push(`${m}: evaluator crashed: ${err.message}`);
      console.log(`${m} ${MUTANTS[m].padEnd(24)} CRASH ${err.message}`);
      continue;
    }
    if (run.status !== 'COMPLETED') {
      violations.push(`${m}: run ABORTED (${run.abortReason})`);
      console.log(`${m} ${MUTANTS[m].padEnd(24)} ABORTED`);
      continue;
    }
    const s = summarize(run.results);
    const status = new Map(run.results.map((r) => [r.id, r.status]));
    const must = MUST_FAIL[m].split(' ');
    const missed = must.filter((id) => status.get(id) !== 'FAIL');
    const extra = run.results.filter((r) => r.status !== 'PASS' && !must.includes(r.id)).map((r) => r.id);
    const ok = missed.length === 0 && s.score < 100;
    if (ok) caught++;
    else violations.push(`${m} ${MUTANTS[m]} (seed ${seed}): not caught by ${missed.map((id) => `${id}=${status.get(id)}`).join(', ') || 'score'}`);
    const cells = must.map((id) => (status.get(id) === 'FAIL' ? `*${id}` : `!${id}=${status.get(id)}`)).concat(extra.map((id) => `+${id}`));
    console.log(`${ok ? 'caught ' : 'MISSED '} ${m} ${MUTANTS[m].padEnd(24)} ${String(s.score).padStart(3)}/100  ${cells.join(' ')}`);
  }
  console.log(`\nMutants caught: ${caught}/${list.length}`);

  // 3. aborts
  const ref = await startReference(cfg.setId, '');
  try {
    const sample = { ...cfg.sample };
    const res = await request('POST', `${ref.url}/api/${cfg.resource}`, { body: sample });
    if (res.status !== 201) violations.push(`could not add a record for the non-empty check (${res.status})`);
    const run = await runSet({ config: cfg, url: ref.url, seed: 1, waitSeconds: 5 });
    const ok = run.status === 'ABORTED' && run.abortReason === 'not-empty';
    console.log(`abort on non-empty server:    ${ok ? 'ok' : 'NOT ABORTED'}`);
    if (!ok) violations.push('evaluator did not ABORT on a non-empty server');
  } finally {
    await ref.stop();
  }
  const port = await freePort();
  const run = await runSet({ config: cfg, url: `http://127.0.0.1:${port}`, seed: 1, waitSeconds: 2, pollMs: 250 });
  const ok = run.status === 'ABORTED' && run.abortReason === 'unreachable';
  console.log(`abort when nothing listening: ${ok ? 'ok' : 'NOT ABORTED'}`);
  if (!ok) violations.push('evaluator did not ABORT when nothing was listening');

  if (violations.length) {
    console.log(`\nVERIFY FAILED (${violations.length}):`);
    for (const v of violations) console.log(`  - ${v}`);
    process.exit(1);
  }
  console.log(`\nVERIFY PASSED for ${cfg.setId}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { MUST_FAIL, applicable };
