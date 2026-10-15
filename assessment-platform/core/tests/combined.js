'use strict';
const h = require('./_helpers');

// picks a search word + enum value whose AND result differs from the OR result
function searchAndEnum(ctx) {
  const words = [ctx.special.shared, ctx.special.mixed, ctx.special.text2Only];
  let best = null;
  for (const w of words) {
    for (const v of ctx.cfg.enum.values) {
      const and = ctx.model.query({ search: w, [ctx.F.enum]: v }).total;
      const s = ctx.model.query({ search: w }).total;
      const e = ctx.model.query({ [ctx.F.enum]: v }).total;
      const or = s + e - and;
      if (and !== or && (!best || (and > 0 && best.and === 0) || (and > 0 && and > best.and))) best = { w, v, and };
    }
  }
  return best || { w: words[0], v: ctx.cfg.enum.values[0], and: 0 };
}

const keysOf = (items, field) => items.map((r) => (r ? r[field] : undefined));
const sameKeys = (a, b) => a.length === b.length && a.every((v, i) => (typeof v === 'number' ? Math.abs(v - b[i]) <= 1e-9 : v === b[i]));

module.exports = [
  {
    id: 'X01',
    name: 'Search + filter',
    async run(ctx) {
      const { w, v } = searchAndEnum(ctx);
      const q = { search: w, [ctx.F.enum]: v, limit: 50 };
      const exp = ctx.model.query(q);
      const res = await ctx.list(q);
      const b = h.listBody(res);
      const ok = b && b.total === exp.total && h.sameIdList(h.idsOf(b.data).sort(), exp.data.map((r) => String(r.id)).sort());
      return h.check(ok, res, `total ${exp.total} (search AND ${ctx.F.enum})`);
    },
  },
  {
    id: 'X02',
    name: 'Filter + sort + pagination',
    async run(ctx) {
      const counts = ctx.cfg.enum.values.map((v) => [v, ctx.model.query({ [ctx.F.enum]: v }).total]);
      const [v] = counts.sort((x, y) => y[1] - x[1])[0];
      const q = { [ctx.F.enum]: v, sort: ctx.F.amount, order: 'desc', page: 2, limit: 3 };
      const exp = ctx.model.query(q);
      const res = await ctx.list(q);
      const b = h.listBody(res);
      const want = keysOf(exp.data, ctx.F.amount);
      const ok =
        b && b.total === exp.total && b.totalPages === exp.totalPages &&
        b.data.every((r) => r && r[ctx.F.enum] === v) &&
        sameKeys(keysOf(b.data, ctx.F.amount), want);
      return h.check(ok, res, `total ${exp.total}, totalPages ${exp.totalPages}, ${ctx.F.amount} values ${JSON.stringify(want)}`);
    },
  },
  {
    id: 'X03',
    name: 'Search + filter + sort + page together',
    async run(ctx) {
      const { w, v } = searchAndEnum(ctx);
      const q = { search: w, [ctx.F.enum]: v, sort: ctx.F.count, order: 'asc', page: 1, limit: 2 };
      const exp = ctx.model.query(q);
      const res = await ctx.list(q);
      const b = h.listBody(res);
      const want = keysOf(exp.data, ctx.F.count);
      const ok =
        b && b.total === exp.total && b.totalPages === exp.totalPages &&
        sameKeys(keysOf(b.data, ctx.F.count), want) &&
        b.data.every((r) => r && r[ctx.F.enum] === v);
      return h.check(ok, res, `total ${exp.total}, totalPages ${exp.totalPages}, ${ctx.F.count} values ${JSON.stringify(want)}`);
    },
  },
  {
    id: 'X04',
    name: 'min greater than max',
    async run(ctx) {
      const [minP, maxP] = ctx.cfg.amount.rangeFilter;
      const a = ctx.seedRecords().map((r) => r[ctx.F.amount]).sort((x, y) => x - y);
      const hi = a[a.length - 1];
      const lo = a[0];
      const res = await ctx.list({ [minP]: hi, [maxP]: lo });
      const b = h.listBody(res);
      return h.check(b && b.data.length === 0 && b.total === 0 && b.totalPages === 0, res, '200, data [], total 0, totalPages 0');
    },
  },
];
