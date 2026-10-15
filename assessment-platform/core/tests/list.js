'use strict';
const h = require('./_helpers');

function wellFormed(cfg, F, item) {
  if (!item || typeof item !== 'object' || !h.hasId(item.id)) return 'missing id';
  const s = (v, spec) => typeof v === 'string' && v.trim().length >= spec.minLen && v.trim().length <= spec.maxLen;
  if (!s(item[F.text1], cfg.text1)) return `${F.text1} is not a valid string`;
  if (!s(item[F.text2], cfg.text2)) return `${F.text2} is not a valid string`;
  if (!cfg.enum.values.includes(item[F.enum])) return `${F.enum} is not an allowed value`;
  if (typeof item[F.amount] !== 'number') return `${F.amount} is not a number`;
  if (!Number.isInteger(item[F.count])) return `${F.count} is not an integer`;
  if (typeof item[F.flag] !== 'boolean') return `${F.flag} is not a boolean`;
  if (F.code && typeof item[F.code] !== 'string') return `${F.code} is not a string`;
  return null;
}

module.exports = [
  {
    id: 'L01',
    name: 'GET list',
    async run(ctx) {
      const res = await ctx.list({});
      return h.check(res.status === 200, res, '200');
    },
  },
  {
    id: 'L02',
    name: 'body.data is an array',
    async run(ctx) {
      const res = await ctx.list({});
      return h.check(!!h.listBody(res), res, '200 with "data" as an array');
    },
  },
  {
    id: 'L03',
    name: 'page, limit, total, totalPages are numbers',
    async run(ctx) {
      const res = await ctx.list({});
      const b = h.listBody(res);
      const ok = b && ['page', 'limit', 'total', 'totalPages'].every((k) => typeof b[k] === 'number');
      return h.check(ok, res, 'page, limit, total and totalPages are JSON numbers');
    },
  },
  {
    id: 'L04',
    name: 'Defaults with no params',
    async run(ctx) {
      const res = await ctx.list({});
      const b = h.listBody(res);
      return h.check(b && b.page === 1 && b.limit === 10, res, 'page = 1 and limit = 10');
    },
  },
  {
    id: 'L05',
    name: 'Default page size',
    async run(ctx) {
      const res = await ctx.list({});
      const b = h.listBody(res);
      const want = Math.min(10, ctx.model.size);
      return h.check(b && b.data.length === want, res, `${want} items in data`, b ? `got ${b.data.length} items` : '');
    },
  },
  {
    id: 'L06',
    name: 'total is correct',
    async run(ctx) {
      const res = await ctx.list({});
      const b = h.listBody(res);
      return h.check(b && b.total === ctx.model.size, res, `total = ${ctx.model.size}`);
    },
  },
  {
    id: 'L07',
    name: 'Every item is well formed',
    async run(ctx) {
      const res = await ctx.list({ limit: 50 });
      const b = h.listBody(res);
      if (!b || b.data.length === 0) return h.fail(res, '200 with items in data');
      for (const item of b.data) {
        const problem = wellFormed(ctx.cfg, ctx.F, item);
        if (problem) return h.fail(res, 'every item has an id and all required fields with correct types', `item ${JSON.stringify(item && item.id)}: ${problem}`);
      }
      return h.pass();
    },
  },
  {
    id: 'L08',
    name: 'Default order',
    async run(ctx) {
      const res = await ctx.list({});
      const b = h.listBody(res);
      const want = ctx.model.query({}).data.map((r) => String(r.id));
      return h.check(b && h.sameIdList(h.idsOf(b.data), want), res, `ids in creation order: ${want.join(', ')}`);
    },
  },
];
