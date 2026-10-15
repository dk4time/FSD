'use strict';
const h = require('./_helpers');

// Each test creates its own scratch record with POST (BLOCKED if that POST fails).

// a full valid replacement body that keeps the record's own unique code
function replacementFor(ctx, rec) {
  const body = ctx.gen.makeRecord();
  if (ctx.F.code) body[ctx.F.code] = rec.fields[ctx.F.code];
  return body;
}

async function putValid(ctx) {
  const rec = await ctx.scratch();
  const body = replacementFor(ctx, rec);
  const res = await ctx.put(rec.id, body);
  if (res.status === 200) ctx.model.update(rec.id, body);
  return { rec, body, res };
}

module.exports = [
  {
    id: 'U01',
    name: 'PUT a valid full record',
    async run(ctx) {
      const { res } = await putValid(ctx);
      return h.check(res.status === 200, res, '200');
    },
  },
  {
    id: 'U02',
    name: 'Response reflects the new values',
    async run(ctx) {
      const { body, res } = await putValid(ctx);
      const diffs = h.fieldDiffs(ctx.cfg, body, res.json);
      return h.check(res.status === 200 && diffs.length === 0, res, '200 with every field equal to the PUT body', diffs.join('; '));
    },
  },
  {
    id: 'U03',
    name: 'id is unchanged',
    async run(ctx) {
      const { rec, res } = await putValid(ctx);
      return h.check(res.status === 200 && res.json && h.sameId(res.json.id, rec.id), res, `200 with id ${rec.id}`);
    },
  },
  {
    id: 'U04',
    name: 'GET after PUT shows new values',
    async run(ctx) {
      const { rec, body, res } = await putValid(ctx);
      if (res.status !== 200) return h.fail(res, '200 for the PUT');
      const got = await ctx.getOne(rec.id);
      const diffs = h.fieldDiffs(ctx.cfg, body, got.json);
      return h.check(got.status === 200 && diffs.length === 0, got, 'GET returns the new values', diffs.join('; '));
    },
  },
  {
    id: 'U05',
    name: 'PUT missing a required field',
    async run(ctx) {
      const rec = await ctx.scratch();
      const body = replacementFor(ctx, rec);
      delete body[ctx.F.text2];
      const res = await ctx.put(rec.id, body);
      return h.check(res.status === 400, res, `400 (body has no ${ctx.F.text2})`);
    },
  },
  {
    id: 'U06',
    name: 'PUT with an invalid value',
    async run(ctx) {
      const rec = await ctx.scratch();
      const body = replacementFor(ctx, rec);
      body[ctx.F.enum] = ctx.gen.invalid.invalidEnum;
      const res = await ctx.put(rec.id, body);
      return h.check(res.status === 400, res, `400 (${ctx.F.enum} "${body[ctx.F.enum]}" is not allowed)`);
    },
  },
  {
    id: 'U07',
    name: 'PUT on an unknown id',
    async run(ctx) {
      const before = await ctx.serverTotal();
      for (const id of [h.UNKNOWN_NUMERIC_ID, h.UNKNOWN_STRING_ID]) {
        const res = await ctx.put(id, ctx.gen.makeRecord());
        if (res.status !== 404) return h.fail(res, '404 (PUT never creates)');
      }
      const after = await ctx.serverTotal();
      return h.check(before.total !== null && after.total === before.total, after.res, `list total unchanged (${before.total})`);
    },
  },
  {
    id: 'U08',
    name: 'Other records untouched',
    async run(ctx) {
      const { res } = await putValid(ctx);
      if (res.status !== 200) return h.fail(res, '200 for the PUT');
      return ctx.spotCheckSeeds(3);
    },
  },
  {
    id: 'U09',
    name: 'id inside the body is ignored',
    async run(ctx) {
      const rec = await ctx.scratch();
      const body = { ...replacementFor(ctx, rec), id: 555555555 };
      const res = await ctx.put(rec.id, body);
      if (res.status !== 200) return h.fail(res, '200');
      if (!res.json || !h.sameId(res.json.id, rec.id)) return h.fail(res, `response id stays ${rec.id}`);
      const got = await ctx.getOne(rec.id);
      return h.check(got.status === 200 && got.json && h.sameId(got.json.id, rec.id), got, `GET /${rec.id} still returns id ${rec.id}`);
    },
  },
  {
    id: 'U10',
    name: 'Uniqueness on PUT',
    async run(ctx) {
      const { F } = ctx;
      const rec = await ctx.scratch();
      const other = ctx.pickSeed();
      if (F.code) {
        const body = ctx.gen.makeRecord();
        body[F.code] = h.toggleCase(other[F.code]);
        const res = await ctx.put(rec.id, body);
        return h.check(res.status === 409, res, `409 (${F.code} "${body[F.code]}" belongs to record ${other.id})`);
      }
      const body = {};
      for (const k of Object.keys(rec.fields)) body[k] = other[k];
      const res = await ctx.put(rec.id, body);
      if (res.status === 200) ctx.model.update(rec.id, body);
      return h.check(res.status === 200, res, `200 (values identical to record ${other.id} are allowed)`);
    },
  },
];
