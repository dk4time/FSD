'use strict';
const h = require('./_helpers');

// C01-C05 inspect the seed phase (run by the engine before any other test).
// C06-C14 run last because a broken server may store junk from them.

function expect400(ctx, payload, label) {
  return ctx.post(payload).then((res) => ({ res, ok: res.status === 400, label }));
}

async function allMust400(ctx, cases) {
  for (const [label, payload] of cases) {
    const r = await expect400(ctx, payload, label);
    if (!r.ok) return h.fail(r.res, `400 for ${label}`);
  }
  return h.pass();
}

module.exports = [
  {
    id: 'C01',
    name: 'POST a valid record',
    async run(ctx) {
      const s = ctx.seed.results[0];
      if (!s) return h.fail(null, '201 Created');
      return h.check(s.res.status === 201, s.res, '201 Created');
    },
  },
  {
    id: 'C02',
    name: 'Created record has a non-empty id',
    async run(ctx) {
      const s = ctx.seed.results[0];
      if (!s) return h.fail(null, 'body.id exists');
      return h.check(s.res.json && h.hasId(s.res.json.id), s.res, 'response body has a non-empty id');
    },
  },
  {
    id: 'C03',
    name: 'Response echoes every submitted field',
    async run(ctx) {
      const { payload, expected } = ctx.padded;
      const res = await ctx.post(payload);
      const ok2xx = res.status >= 200 && res.status < 300 && res.json && h.hasId(res.json.id);
      if (ok2xx) ctx.model.add(res.json.id, expected);
      if (!ok2xx) return h.fail(res, `2xx with the created record (${ctx.F.text1} trimmed)`);
      const diffs = h.fieldDiffs(ctx.cfg, expected, res.json);
      return h.check(diffs.length === 0, res, `every field echoed, ${ctx.F.text1} trimmed`, diffs.join('; '));
    },
  },
  {
    id: 'C04',
    name: 'Two creates get different ids',
    async run(ctx) {
      const [a, b] = ctx.seed.results;
      if (!a || !b) return h.fail(null, 'two different ids');
      const ida = a.res.json && a.res.json.id;
      const idb = b.res.json && b.res.json.id;
      return h.check(h.hasId(ida) && h.hasId(idb) && String(ida) !== String(idb), b.res, 'two different ids', `ids ${JSON.stringify(ida)} and ${JSON.stringify(idb)}`);
    },
  },
  {
    id: 'C05',
    name: 'Created record can be fetched',
    async run(ctx) {
      const s = ctx.seed.results[0];
      if (!s || !h.hasId(s.id)) return h.fail(s && s.res, 'the first POST returns an id that GET can fetch');
      const res = await ctx.getOne(s.id);
      if (res.status !== 200) return h.fail(res, '200 with the created record');
      const diffs = h.fieldDiffs(ctx.cfg, ctx.model.get(s.id) || s.payload, res.json);
      return h.check(diffs.length === 0, res, 'same field values as submitted', diffs.join('; '));
    },
  },
  {
    id: 'C06',
    name: 'Missing required text field',
    async run(ctx) {
      const res = await ctx.post(ctx.gen.invalid.missing(ctx.F.text1));
      return h.check(res.status === 400 && h.isErrorBody(res), res, '400 + JSON body with a non-empty "error" or "message"');
    },
  },
  {
    id: 'C07',
    name: 'Missing required numeric field',
    async run(ctx) {
      const res = await ctx.post(ctx.gen.invalid.missing(ctx.F.amount));
      return h.check(res.status === 400 && h.isErrorBody(res), res, '400 + JSON body with a non-empty "error" or "message"');
    },
  },
  {
    id: 'C08',
    name: 'Wrong types',
    async run(ctx) {
      const { F } = ctx;
      const inv = ctx.gen.invalid;
      return allMust400(ctx, [
        [`${F.amount} sent as a string`, inv.with(F.amount, '150')],
        [`${F.count} sent as 1.5`, inv.with(F.count, 1.5)],
        [`${F.flag} sent as "yes"`, inv.with(F.flag, 'yes')],
      ]);
    },
  },
  {
    id: 'C09',
    name: 'Amount not above 0',
    async run(ctx) {
      const { F } = ctx;
      const inv = ctx.gen.invalid;
      return allMust400(ctx, [
        [`${F.amount} = 0`, inv.with(F.amount, 0)],
        [`${F.amount} = -5`, inv.with(F.amount, -5)],
      ]);
    },
  },
  {
    id: 'C10',
    name: 'Text1 shorter than minimum',
    async run(ctx) {
      const res = await ctx.post(ctx.gen.invalid.with(ctx.F.text1, ctx.gen.invalid.shortText1()));
      return h.check(res.status === 400, res, `400 for a ${ctx.cfg.text1.minLen - 1}-character ${ctx.F.text1}`);
    },
  },
  {
    id: 'C11',
    name: 'Invalid enum value',
    async run(ctx) {
      const res = await ctx.post(ctx.gen.invalid.with(ctx.F.enum, ctx.gen.invalid.invalidEnum));
      return h.check(res.status === 400, res, '400');
    },
  },
  {
    id: 'C12',
    name: 'Empty object body {}',
    async run(ctx) {
      const res = await ctx.post({});
      return h.check(res.status === 400, res, '400');
    },
  },
  {
    id: 'C13',
    name: 'Malformed JSON body',
    async run(ctx) {
      const res = await ctx.postRaw(ctx.gen.invalid.malformedJson);
      return h.check(res.status === 400 && h.isErrorBody(res), res, '400 with a JSON error body ("error" or "message")');
    },
  },
  {
    id: 'C14',
    name: 'Uniqueness rule',
    async run(ctx) {
      const { F } = ctx;
      if (F.code) {
        const first = await ctx.scratch();
        const dup = ctx.gen.makeRecord();
        dup[F.code] = h.toggleCase(first.fields[F.code]);
        const res = await ctx.post(dup);
        return h.check(res.status === 409, res, `409 for ${F.code} "${dup[F.code]}" (same as "${first.fields[F.code]}" in different letter case)`);
      }
      const payload = ctx.gen.makeRecord();
      const r1 = await ctx.post(payload);
      if (r1.status !== 201) return h.fail(r1, '201 for the first of two identical POSTs');
      const r2 = await ctx.post(payload);
      if (r2.status !== 201) return h.fail(r2, '201 for the second identical POST (no uniqueness rule in this set)');
      const a = r1.json && r1.json.id;
      const b = r2.json && r2.json.id;
      return h.check(h.hasId(a) && h.hasId(b) && String(a) !== String(b), r2, 'two different ids', `ids ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
    },
  },
];
