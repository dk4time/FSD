'use strict';
// Runs the 100 tests of one question set against a running API and returns every result.
// Never prints anything: callers decide what (if anything) to show.

const { request } = require('./http');
const { makeRng } = require('./rng');
const { createGenerator, fieldNames, SEED_COUNT } = require('./generator');
const { Model } = require('./model');
const h = require('./tests/_helpers');

// report order
const GROUPS = [
  { key: 'create', title: 'Create (POST)', tests: require('./tests/create') },
  { key: 'readOne', title: 'Read one (GET /:id)', tests: require('./tests/readOne') },
  { key: 'list', title: 'List basics (GET)', tests: require('./tests/list') },
  { key: 'update', title: 'Update (PUT)', tests: require('./tests/update') },
  { key: 'patch', title: 'Update (PATCH)', tests: require('./tests/patch') },
  { key: 'delete', title: 'Delete (DELETE)', tests: require('./tests/delete') },
  { key: 'pagination', title: 'Pagination', tests: require('./tests/pagination') },
  { key: 'filter', title: 'Filter', tests: require('./tests/filter') },
  { key: 'search', title: 'Search', tests: require('./tests/search') },
  { key: 'sort', title: 'Sort', tests: require('./tests/sort') },
  { key: 'combined', title: 'Combined queries', tests: require('./tests/combined') },
  { key: 'http', title: 'HTTP basics', tests: require('./tests/http') },
];

const TESTS = [];
for (const g of GROUPS) for (const t of g.tests) TESTS.push({ ...t, group: g.key });
const BY_ID = new Map(TESTS.map((t) => [t.id, t]));
const TEST_IDS = TESTS.map((t) => t.id);

// execution order: seed phase -> read-only groups -> mutating groups -> negative creates
const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(2, '0')}`);
const EXEC_ORDER = [
  ...range('C', 1, 5),
  ...range('R', 1, 8),
  ...range('L', 1, 8),
  ...range('G', 1, 12),
  ...range('F', 1, 10),
  ...range('S', 1, 8),
  ...range('O', 1, 6),
  ...range('X', 1, 4),
  'H01',
  'H02',
  ...range('U', 1, 10),
  ...range('P', 1, 10),
  ...range('D', 1, 8),
  ...range('C', 6, 14),
];

const NEVER_BLOCKED = new Set([...range('C', 1, 14), 'H02']);
const MIN_SEEDS_OK = 40;
const GROUP_OF = { C: 'create', R: 'readOne', L: 'list', U: 'update', P: 'patch', D: 'delete', G: 'pagination', F: 'filter', S: 'search', O: 'sort', X: 'combined', H: 'http' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildContext(cfg, baseUrl, seed) {
  const F = fieldNames(cfg);
  const genRng = makeRng(seed);
  const testRng = makeRng((seed ^ 0x9e3779b9) >>> 0);
  const gen = createGenerator(cfg, genRng);
  const model = new Model(cfg);
  const resourcePath = `/api/${cfg.resource}`;
  const seedIds = [];

  async function call(method, pathAndQuery, opts = {}) {
    const res = await request(method, baseUrl + pathAndQuery, opts);
    let body = '';
    if (opts.raw !== undefined) body = ' ' + h.snippet(opts.raw, 160);
    else if (opts.body !== undefined) body = ' ' + h.snippet(JSON.stringify(opts.body), 160);
    res.request = `${method} ${pathAndQuery}${body}`;
    return res;
  }

  const enc = (id) => encodeURIComponent(String(id));

  const padded = (() => {
    const expected = gen.makeRecord();
    const payload = { ...expected, [F.text1]: `  ${expected[F.text1]}  ` };
    return { payload, expected };
  })();

  const ctx = {
    cfg,
    F,
    gen,
    model,
    rng: testRng,
    special: gen.special,
    padded,
    seed: { results: [], okCount: 0 },
    post: (body) => call('POST', resourcePath, { body }),
    postRaw: (raw) => call('POST', resourcePath, { raw }),
    getOne: (id) => call('GET', `${resourcePath}/${enc(id)}`),
    put: (id, body) => call('PUT', `${resourcePath}/${enc(id)}`, { body }),
    patch: (id, body) => call('PATCH', `${resourcePath}/${enc(id)}`, { body }),
    del: (id) => call('DELETE', `${resourcePath}/${enc(id)}`),
    list: (params) => call('GET', resourcePath + h.qs(params || {})),
    rootGet: (p) => call('GET', p),

    // seed records still held by the model (read-only tests use these)
    seedRecords() {
      return seedIds.map((id) => model.get(id)).filter(Boolean);
    },
    pickSeed() {
      return testRng.pick(ctx.seedRecords());
    },

    // creates a fresh record for a mutating test; BLOCKED if the POST does not work
    async scratch() {
      const fields = gen.makeRecord();
      const res = await ctx.post(fields);
      const id = res.json && res.json.id;
      if (res.status < 200 || res.status >= 300 || !h.hasId(id)) {
        throw new h.Blocked(`could not create a record for this test: ${res.request} -> ${h.actualOf(res)}`);
      }
      model.add(id, fields);
      return { id, fields };
    },

    async serverTotal() {
      const res = await ctx.list({ limit: 1 });
      const b = h.listBody(res);
      return { total: b && typeof b.total === 'number' ? b.total : null, res };
    },

    // reads pages of the default list until an empty page (does not trust totalPages);
    // bounded so a broken server cannot loop forever
    async listAll(limit) {
      const maxPages = Math.ceil(Math.max(model.size, 1) / limit) + 3;
      const ids = [];
      let res;
      for (let page = 1; page <= maxPages; page++) {
        res = await ctx.list({ page, limit });
        const b = h.listBody(res);
        if (!b) return { ok: false, ids, res };
        if (b.data.length === 0) break;
        ids.push(...h.idsOf(b.data));
      }
      return { ok: true, ids, res };
    },

    async spotCheckSeeds(n) {
      const recs = testRng.sample(ctx.seedRecords(), n);
      for (const rec of recs) {
        const res = await ctx.getOne(rec.id);
        const diffs = h.fieldDiffs(cfg, rec, res.json);
        if (res.status !== 200 || diffs.length) return h.fail(res, `record ${rec.id} unchanged`, diffs.join('; '));
      }
      return h.pass();
    },

    _seedIds: seedIds,
    _seedCount: SEED_COUNT,
  };
  return ctx;
}

async function preflight(baseUrl, cfg, waitSeconds, pollMs) {
  const url = `${baseUrl}/api/${cfg.resource}`;
  const until = Date.now() + waitSeconds * 1000;
  let res;
  for (;;) {
    res = await request('GET', url, { timeoutMs: 5000 });
    if (res.status > 0) break;
    if (Date.now() >= until) return { ok: false, reason: 'unreachable' };
    await sleep(pollMs);
  }
  // The server must start empty. A list that shows records means old data is still there.
  // (A list that is not implemented yet does not abort: those tests simply fail.)
  const j = res.json;
  const shown =
    Array.isArray(j) ? j.length :
    j && typeof j === 'object' ? (typeof j.total === 'number' ? j.total : Array.isArray(j.data) ? j.data.length : 0) : 0;
  if (res.status === 200 && shown > 0) return { ok: false, reason: 'not-empty' };
  return { ok: true };
}

/**
 * opts: { config, url, seed, only: ['C01',...], waitSeconds, timeLimitMs, onProgress(attempted, total) }
 * returns { status: 'COMPLETED'|'ABORTED', abortReason, seed, startedAt, finishedAt, durationMs, results }
 */
async function runSet(opts) {
  const cfg = opts.config;
  const baseUrl = String(opts.url || 'http://localhost:8080').replace(/\/+$/, '');
  const seed = opts.seed >>> 0;
  const waitSeconds = opts.waitSeconds === undefined ? 60 : opts.waitSeconds;
  const timeLimitMs = opts.timeLimitMs || 180000;
  const onProgress = opts.onProgress || (() => {});
  const startedAt = new Date();
  const finish = (extra) => {
    const finishedAt = new Date();
    return { seed, setId: cfg.setId, serverUrl: baseUrl, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt - startedAt, ...extra };
  };

  const selected = opts.only && opts.only.length ? new Set(opts.only.map((s) => s.trim().toUpperCase())) : null;
  if (selected) for (const id of selected) if (!BY_ID.has(id)) throw new Error(`unknown test id ${id}`);

  const pre = await preflight(baseUrl, cfg, waitSeconds, opts.pollMs || 1000);
  if (!pre.ok) return finish({ status: 'ABORTED', abortReason: pre.reason, results: [] });

  const deadline = Date.now() + timeLimitMs;
  const ctx = buildContext(cfg, baseUrl, seed);

  // seed phase: 45 valid records, in order
  for (const payload of ctx.gen.seeds) {
    if (Date.now() > deadline) break;
    const res = await ctx.post(payload);
    const id = res.json && res.json.id;
    const ok = res.status >= 200 && res.status < 300 && h.hasId(id);
    if (ok) {
      ctx.model.add(id, payload);
      ctx._seedIds.push(id);
      ctx.seed.okCount++;
    }
    ctx.seed.results.push({ payload, res, id: ok ? id : undefined });
  }
  const seedsBroken = ctx.seed.okCount < MIN_SEEDS_OK;

  const order = EXEC_ORDER.filter((id) => !selected || selected.has(id));
  const results = new Map();
  let attempted = 0;
  for (const id of order) {
    const t = BY_ID.get(id);
    const started = Date.now();
    let r;
    if (Date.now() > deadline) {
      r = { status: 'FAIL', detail: { request: '', expected: 'test run', actual: 'run time limit' } };
    } else if (seedsBroken && !NEVER_BLOCKED.has(id)) {
      r = { status: 'BLOCKED', detail: { request: 'POST seed records', expected: `at least ${MIN_SEEDS_OK} of ${SEED_COUNT} seed POSTs return 2xx with an id`, actual: `only ${ctx.seed.okCount} did` } };
    } else {
      try {
        const out = await t.run(ctx);
        r = out.pass ? { status: 'PASS', detail: null } : { status: 'FAIL', detail: { request: out.request || '', expected: out.expected || '', actual: out.actual || '' } };
      } catch (err) {
        if (err instanceof h.Blocked) r = { status: 'BLOCKED', detail: { request: '', expected: 'a working POST to create this test\'s own record', actual: err.message } };
        else r = { status: 'FAIL', detail: { request: '', expected: 'a well-formed response', actual: `unexpected response shape (${err.message})` } };
      }
    }
    results.set(id, { id, name: t.name, group: t.group, ...r, ms: Date.now() - started });
    attempted++;
    onProgress(attempted, order.length);
  }

  const ordered = TEST_IDS.filter((id) => results.has(id)).map((id) => results.get(id));
  return finish({ status: 'COMPLETED', results: ordered });
}

function summarize(results) {
  const s = { score: 0, passed: 0, failed: 0, blocked: 0, groups: {} };
  for (const g of GROUPS) s.groups[g.key] = { title: g.title, passed: 0, total: 0 };
  for (const r of results) {
    const g = s.groups[r.group || GROUP_OF[r.id[0]]];
    g.total++;
    if (r.status === 'PASS') {
      s.passed++;
      g.passed++;
    } else if (r.status === 'BLOCKED') s.blocked++;
    else s.failed++;
  }
  s.score = s.passed;
  return s;
}

module.exports = { runSet, summarize, GROUPS, TESTS, TEST_IDS, EXEC_ORDER, GROUP_OF };
