'use strict';
const h = require('./_helpers');

module.exports = [
  {
    id: 'R01',
    name: 'GET an existing record',
    async run(ctx) {
      const rec = ctx.pickSeed();
      const res = await ctx.getOne(rec.id);
      return h.check(res.status === 200, res, '200');
    },
  },
  {
    id: 'R02',
    name: 'Body fields equal what was stored',
    async run(ctx) {
      const rec = ctx.pickSeed();
      const res = await ctx.getOne(rec.id);
      const diffs = h.fieldDiffs(ctx.cfg, rec, res.json);
      return h.check(res.status === 200 && diffs.length === 0, res, 'all fields equal the stored record', diffs.join('; '));
    },
  },
  {
    id: 'R03',
    name: 'body.id equals the requested id',
    async run(ctx) {
      const rec = ctx.pickSeed();
      const res = await ctx.getOne(rec.id);
      return h.check(res.status === 200 && res.json && h.sameId(res.json.id, rec.id), res, `id ${rec.id}`);
    },
  },
  {
    id: 'R04',
    name: 'Unknown numeric id',
    async run(ctx) {
      const res = await ctx.getOne(h.UNKNOWN_NUMERIC_ID);
      return h.check(res.status === 404, res, '404');
    },
  },
  {
    id: 'R05',
    name: '404 body is JSON with an error string',
    async run(ctx) {
      const res = await ctx.getOne(h.UNKNOWN_NUMERIC_ID);
      return h.check(res.status === 404 && h.isErrorBody(res), res, '404 + JSON body with a non-empty "error" or "message"');
    },
  },
  {
    id: 'R06',
    name: 'Non-id-looking path (/abc-not-an-id)',
    async run(ctx) {
      const res = await ctx.getOne('abc-not-an-id');
      return h.check(res.status === 404, res, '404 (not 400 or 500)');
    },
  },
  {
    id: 'R07',
    name: 'Content-Type is JSON',
    async run(ctx) {
      const rec = ctx.pickSeed();
      const res = await ctx.getOne(rec.id);
      return h.check(res.status === 200 && h.isJsonType(res), res, 'Content-Type application/json', `Content-Type "${res.contentType}"`);
    },
  },
  {
    id: 'R08',
    name: 'Five different seeded ids',
    async run(ctx) {
      const recs = ctx.rng.sample(ctx.seedRecords(), 5);
      for (const rec of recs) {
        const res = await ctx.getOne(rec.id);
        const diffs = h.fieldDiffs(ctx.cfg, rec, res.json);
        if (res.status !== 200 || !res.json || !h.sameId(res.json.id, rec.id) || diffs.length) {
          return h.fail(res, `200 with record ${rec.id}`, diffs.join('; '));
        }
      }
      return h.pass();
    },
  },
];
