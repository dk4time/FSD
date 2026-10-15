'use strict';
const h = require('./_helpers');

function otherEnum(ctx, current) {
  return ctx.cfg.enum.values.find((v) => v !== current);
}

function newCount(ctx, current) {
  return current === ctx.cfg.count.min ? ctx.cfg.count.min + 1 : ctx.cfg.count.min;
}

module.exports = [
  {
    id: 'P01',
    name: 'PATCH one field',
    async run(ctx) {
      const rec = await ctx.scratch();
      const body = { [ctx.F.count]: newCount(ctx, rec.fields[ctx.F.count]) };
      const res = await ctx.patch(rec.id, body);
      if (res.status === 200) ctx.model.update(rec.id, body);
      return h.check(res.status === 200, res, '200');
    },
  },
  {
    id: 'P02',
    name: 'Only that field changed',
    async run(ctx) {
      const rec = await ctx.scratch();
      const body = { [ctx.F.count]: newCount(ctx, rec.fields[ctx.F.count]) };
      const res = await ctx.patch(rec.id, body);
      const want = { ...rec.fields, ...body };
      if (res.status === 200) ctx.model.update(rec.id, body);
      const diffs = h.fieldDiffs(ctx.cfg, want, res.json);
      return h.check(res.status === 200 && diffs.length === 0, res, `200 with only ${ctx.F.count} changed`, diffs.join('; '));
    },
  },
  {
    id: 'P03',
    name: 'PATCH several fields',
    async run(ctx) {
      const { F } = ctx;
      const rec = await ctx.scratch();
      const fresh = ctx.gen.makeRecord();
      const body = {
        [F.text1]: fresh[F.text1],
        [F.amount]: fresh[F.amount],
        [F.flag]: !rec.fields[F.flag],
        [F.enum]: otherEnum(ctx, rec.fields[F.enum]),
      };
      const res = await ctx.patch(rec.id, body);
      if (res.status === 200) ctx.model.update(rec.id, body);
      const diffs = h.fieldDiffs(ctx.cfg, { ...rec.fields, ...body }, res.json);
      return h.check(res.status === 200 && diffs.length === 0, res, '200 with all sent fields changed', diffs.join('; '));
    },
  },
  {
    id: 'P04',
    name: 'PATCH with empty body {}',
    async run(ctx) {
      const rec = await ctx.scratch();
      const res = await ctx.patch(rec.id, {});
      return h.check(res.status === 400, res, '400');
    },
  },
  {
    id: 'P05',
    name: 'PATCH with an invalid enum value',
    async run(ctx) {
      const rec = await ctx.scratch();
      const res = await ctx.patch(rec.id, { [ctx.F.enum]: ctx.gen.invalid.invalidEnum });
      return h.check(res.status === 400, res, '400');
    },
  },
  {
    id: 'P06',
    name: 'PATCH with a wrong type',
    async run(ctx) {
      const rec = await ctx.scratch();
      const res = await ctx.patch(rec.id, { [ctx.F.amount]: 'abc' });
      return h.check(res.status === 400, res, `400 (${ctx.F.amount} sent as a string)`);
    },
  },
  {
    id: 'P07',
    name: 'PATCH on an unknown id',
    async run(ctx) {
      for (const id of [h.UNKNOWN_NUMERIC_ID, h.UNKNOWN_STRING_ID]) {
        const res = await ctx.patch(id, { [ctx.F.count]: ctx.cfg.count.min });
        if (res.status !== 404) return h.fail(res, '404');
      }
      return h.pass();
    },
  },
  {
    id: 'P08',
    name: 'Unknown fields ignored',
    async run(ctx) {
      const rec = await ctx.scratch();
      const fresh = ctx.gen.makeRecord();
      const body = { [ctx.F.text2]: fresh[ctx.F.text2], extraNote: 'should not be stored', zzUnknownFlag: true };
      const res = await ctx.patch(rec.id, body);
      if (res.status !== 200) return h.fail(res, '200');
      ctx.model.update(rec.id, { [ctx.F.text2]: fresh[ctx.F.text2] });
      const leaked = (j) => j && typeof j === 'object' && ('extraNote' in j || 'zzUnknownFlag' in j);
      if (leaked(res.json)) return h.fail(res, 'unknown fields not echoed back');
      const got = await ctx.getOne(rec.id);
      return h.check(got.status === 200 && !leaked(got.json), got, 'GET does not show the unknown fields');
    },
  },
  {
    id: 'P09',
    name: 'PATCH cannot change id',
    async run(ctx) {
      const rec = await ctx.scratch();
      const body = { id: 555555556, [ctx.F.count]: newCount(ctx, rec.fields[ctx.F.count]) };
      const res = await ctx.patch(rec.id, body);
      if (res.status !== 200 || !res.json || !h.sameId(res.json.id, rec.id)) return h.fail(res, `200 with id still ${rec.id}`);
      const got = await ctx.getOne(rec.id);
      return h.check(got.status === 200 && got.json && h.sameId(got.json.id, rec.id), got, `GET /${rec.id} still returns id ${rec.id}`);
    },
  },
  {
    id: 'P10',
    name: 'Uniqueness / persistence',
    async run(ctx) {
      const { F } = ctx;
      const rec = await ctx.scratch();
      if (F.code) {
        const other = ctx.pickSeed();
        // U10 may already have stored toggleCase(code) on a server that compares case-sensitively,
        // so use a different case variant here
        const code = h.flipFirstLetter(other[F.code]);
        const res = await ctx.patch(rec.id, { [F.code]: code });
        return h.check(res.status === 409, res, `409 (${F.code} "${code}" belongs to record ${other.id})`);
      }
      const want = !rec.fields[F.flag];
      const res = await ctx.patch(rec.id, { [F.flag]: want });
      if (res.status !== 200) return h.fail(res, '200');
      const got = await ctx.getOne(rec.id);
      return h.check(got.status === 200 && got.json && got.json[F.flag] === want, got, `GET shows ${F.flag} = ${want}`);
    },
  },
];
