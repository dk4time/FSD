'use strict';
// Full-detail evaluator for the trainer. Works for every set in domains/.
//   npm run trainer -- --set A3 [--url http://localhost:8080] [--seed N] [--only C01,C02] [--wait 60]
//                      [--reg 22CS001 --save [--note "re-run on lab PC"]] [--collector http://localhost:4000]
const path = require('path');
const { runSet } = require('../core/engine');
const { randomSeed } = require('../core/rng');
const { normalizeReg } = require('../core/assign');
const { buildResultDoc, postResult } = require('../core/submit');
const { readEnv } = require('../scripts/read-env');
const { renderTrainer } = require('./render');
const { loadSet, listSets, parseArgs } = require('./domains');

const USAGE =
  'Usage: npm run trainer -- --set <SET> [--url http://localhost:8080] [--seed N] [--only C01,C02] [--wait 60] [--reg REG --save [--note TEXT]]';

async function main() {
  const args = parseArgs(process.argv.slice(2), ['save']);
  if (!args.set) {
    console.error(`${USAGE}\nSets: ${listSets().join(', ')}`);
    process.exit(1);
  }
  const cfg = loadSet(args.set);
  const url = args.url || 'http://localhost:8080';
  const seed = args.seed !== undefined ? Number(args.seed) >>> 0 : randomSeed();
  const only = args.only ? String(args.only).split(',').filter(Boolean) : null;
  const waitSeconds = args.wait !== undefined ? Number(args.wait) : 60;

  let env = null;
  if (args.save) {
    env = readEnv(path.join(__dirname, '..', 'collector', '.env'));
    if (!env || !env.ADMIN_PASSWORD || !env.COLLECTOR_KEY) {
      console.error('--save needs collector/.env with ADMIN_PASSWORD and COLLECTOR_KEY.');
      process.exit(1);
    }
  }

  const isTTY = process.stderr.isTTY;
  console.error(`Evaluating set ${cfg.setId} at ${url} (seed ${seed}) ...`);
  const run = await runSet({
    config: cfg,
    url,
    seed,
    only,
    waitSeconds,
    onProgress: (n, total) => {
      if (isTTY) process.stderr.write(`\r  ${n} / ${total} tests run`);
    },
  });
  if (isTTY) process.stderr.write('\n');

  console.log(renderTrainer(run, cfg));
  if (run.status === 'ABORTED') process.exit(2);

  if (args.save) {
    const reg = args.reg ? normalizeReg(args.reg) : '';
    const doc = buildResultDoc({
      run,
      registrationNumber: reg,
      mode: 'trainer',
      key: env.COLLECTOR_KEY,
      extra: { note: args.note ? String(args.note) : '' },
    });
    const collector = (args.collector || `http://localhost:${env.PORT || 4000}`).replace(/\/+$/, '');
    const auth = 'Basic ' + Buffer.from(`admin:${env.ADMIN_PASSWORD}`).toString('base64');
    const r = await postResult(`${collector}/admin/api/trainer-runs`, doc, { authorization: auth });
    if (r.kind === 'ok') {
      console.log(`\nSaved as a trainer run for ${reg || '(no registration number)'} (run id ${doc.runId}, stored score ${r.body && r.body.score}).`);
    } else {
      console.error(`\nNot saved: ${r.message}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
