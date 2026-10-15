'use strict';
const h = require('./_helpers');

const contains = (ctx, item, term) =>
  !!item && [ctx.F.text1, ctx.F.text2].some((f) => typeof item[f] === 'string' && item[f].toLowerCase().includes(term.toLowerCase()));

async function expectSearch(ctx, term, label) {
  const q = { search: term, limit: 50 };
  const res = await ctx.list(q);
  const b = h.listBody(res);
  const exp = ctx.model.query(q);
  const ok = b && b.total === exp.total && h.sameIdList(h.idsOf(b.data).sort(), exp.data.map((r) => String(r.id)).sort());
  return h.check(ok, res, `${label}: total ${exp.total}, exactly the matching records`, b ? `total ${b.total}` : '');
}

module.exports = [
  {
    id: 'S01',
    name: 'Search a text1 word',
    async run(ctx) {
      const term = ctx.special.shared;
      const res = await ctx.list({ search: term, limit: 50 });
      const b = h.listBody(res);
      const ok = b && b.data.length > 0 && b.data.every((item) => contains(ctx, item, term));
      return h.check(ok, res, `non-empty result, every item contains "${term}" in ${ctx.F.text1} or ${ctx.F.text2}`);
    },
  },
  {
    id: 'S02',
    name: 'Case-insensitive',
    async run(ctx) {
      const word = ctx.special.mixed;
      const want = ctx.model.query({ search: word }).total;
      for (const term of [word.toUpperCase(), word.toLowerCase()]) {
        const res = await ctx.list({ search: term });
        const b = h.listBody(res);
        if (!b || b.total !== want) return h.fail(res, `total ${want} for search=${term} (case must not matter)`);
      }
      return h.pass();
    },
  },
  {
    id: 'S03',
    name: 'Search a text2 word',
    run: (ctx) => expectSearch(ctx, ctx.special.text2Only, `search=${ctx.special.text2Only} (a word that only appears in ${ctx.F.text2})`),
  },
  {
    id: 'S04',
    name: 'Term that matches nothing',
    async run(ctx) {
      const res = await ctx.list({ search: ctx.special.noMatch });
      const b = h.listBody(res);
      return h.check(b && b.data.length === 0 && b.total === 0 && b.totalPages === 0, res, '200, data [], total 0, totalPages 0');
    },
  },
  {
    id: 'S05',
    name: 'total equals the expected count',
    run: (ctx) => expectSearch(ctx, ctx.special.shared, `search=${ctx.special.shared}`),
  },
  {
    id: 'S06',
    name: 'Search + pagination',
    async run(ctx) {
      const q = { search: ctx.special.shared, page: 2, limit: 2 };
      const exp = ctx.model.query(q);
      const res = await ctx.list(q);
      const b = h.listBody(res);
      const ok = b && b.total === exp.total && b.totalPages === exp.totalPages && h.sameIdList(h.idsOf(b.data), exp.data.map((r) => String(r.id)));
      return h.check(ok, res, `total ${exp.total}, totalPages ${exp.totalPages}, ids ${exp.data.map((r) => r.id).join(', ')}`);
    },
  },
  {
    id: 'S07',
    name: 'Partial term (first 3 letters)',
    run: (ctx) => expectSearch(ctx, ctx.special.shared.slice(0, 3), `search=${ctx.special.shared.slice(0, 3)}`),
  },
  {
    id: 'S08',
    name: 'Empty search= value',
    async run(ctx) {
      const res = await ctx.list({ search: '' });
      const b = h.listBody(res);
      const exp = ctx.model.query({});
      const ok = b && b.total === exp.total && h.sameIdList(h.idsOf(b.data), exp.data.map((r) => String(r.id)));
      return h.check(ok, res, `same as no search: total ${exp.total}, first page in creation order`);
    },
  },
];
