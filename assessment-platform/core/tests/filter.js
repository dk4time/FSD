'use strict';
const h = require('./_helpers');

// asks for every match on one page (limit 50) and compares count and membership with the model
async function expectFilter(ctx, params, label) {
  const q = { ...params, limit: 50 };
  const res = await ctx.list(q);
  const b = h.listBody(res);
  const exp = ctx.model.query(q);
  const want = exp.data.map((r) => String(r.id)).sort();
  const got = b ? h.idsOf(b.data).sort() : [];
  const ok = b && b.total === exp.total && h.sameIdList(got, want);
  return h.check(ok, res, `${label}: total ${exp.total}, exactly the matching records`, b ? `total ${b.total}, ${b.data.length} items` : '');
}

function amounts(ctx) {
  return [...new Set(ctx.seedRecords().map((r) => r[ctx.F.amount]))].sort((a, b) => a - b);
}

module.exports = [
  {
    id: 'F01',
    name: 'Filter by one enum value',
    async run(ctx) {
      const v = ctx.rng.pick(ctx.cfg.enum.values);
      return expectFilter(ctx, { [ctx.F.enum]: v }, `${ctx.F.enum}=${v}`);
    },
  },
  {
    id: 'F02',
    name: 'Every enum value',
    async run(ctx) {
      for (const v of ctx.cfg.enum.values) {
        const res = await ctx.list({ [ctx.F.enum]: v, limit: 1 });
        const b = h.listBody(res);
        const want = ctx.model.query({ [ctx.F.enum]: v }).total;
        if (!b || b.total !== want) return h.fail(res, `total ${want} for ${ctx.F.enum}=${v}`);
      }
      return h.pass();
    },
  },
  { id: 'F03', name: 'flag=true', run: (ctx) => expectFilter(ctx, { [ctx.F.flag]: 'true' }, `${ctx.F.flag}=true`) },
  { id: 'F04', name: 'flag=false', run: (ctx) => expectFilter(ctx, { [ctx.F.flag]: 'false' }, `${ctx.F.flag}=false`) },
  {
    id: 'F05',
    name: 'min<Amount> only',
    async run(ctx) {
      const a = amounts(ctx);
      const v = a[Math.floor(a.length / 2)];
      return expectFilter(ctx, { [ctx.cfg.amount.rangeFilter[0]]: v }, `${ctx.cfg.amount.rangeFilter[0]}=${v}`);
    },
  },
  {
    id: 'F06',
    name: 'max<Amount> only',
    async run(ctx) {
      const a = amounts(ctx);
      const v = a[Math.floor(a.length / 3)];
      return expectFilter(ctx, { [ctx.cfg.amount.rangeFilter[1]]: v }, `${ctx.cfg.amount.rangeFilter[1]}=${v}`);
    },
  },
  {
    id: 'F07',
    name: 'min and max together',
    async run(ctx) {
      const a = amounts(ctx);
      const i = ctx.rng.int(1, Math.max(1, Math.floor(a.length / 2) - 1));
      const j = Math.min(a.length - 2, i + ctx.rng.int(3, 8));
      const [minP, maxP] = ctx.cfg.amount.rangeFilter;
      return expectFilter(ctx, { [minP]: a[i], [maxP]: a[j] }, `${minP}=${a[i]}&${maxP}=${a[j]} (both boundaries inclusive)`);
    },
  },
  {
    id: 'F08',
    name: 'Filter + pagination',
    async run(ctx) {
      const counts = ctx.cfg.enum.values.map((v) => [v, ctx.model.query({ [ctx.F.enum]: v }).total]);
      const [v] = counts.sort((x, y) => y[1] - x[1])[0];
      const q = { [ctx.F.enum]: v, page: 2, limit: 3 };
      const exp = ctx.model.query(q);
      const res = await ctx.list(q);
      const b = h.listBody(res);
      const ok = b && b.total === exp.total && b.totalPages === exp.totalPages && h.sameIdList(h.idsOf(b.data), exp.data.map((r) => String(r.id)));
      return h.check(ok, res, `total ${exp.total}, totalPages ${exp.totalPages}, ids ${exp.data.map((r) => r.id).join(', ')}`);
    },
  },
  {
    id: 'F09',
    name: 'Enum + flag combined',
    async run(ctx) {
      const v = ctx.rng.pick(ctx.cfg.enum.values);
      return expectFilter(ctx, { [ctx.F.enum]: v, [ctx.F.flag]: 'true' }, `${ctx.F.enum}=${v}&${ctx.F.flag}=true`);
    },
  },
  {
    id: 'F10',
    name: 'Invalid filter values',
    async run(ctx) {
      for (const q of [{ [ctx.F.enum]: ctx.gen.invalid.invalidEnum }, { [ctx.F.flag]: 'maybe' }]) {
        const res = await ctx.list(q);
        if (res.status !== 400) return h.fail(res, '400');
      }
      return h.pass();
    },
  },
];
