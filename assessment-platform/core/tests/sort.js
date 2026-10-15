'use strict';
const h = require('./_helpers');

// reads all records sorted on one page (limit 50) and checks the order and that nothing is missing
async function expectSorted(ctx, field, order, isText) {
  const q = { sort: field, limit: 50 };
  if (order) q.order = order;
  const res = await ctx.list(q);
  const b = h.listBody(res);
  const want = ctx.model.query(q).data.map((r) => String(r.id)).sort();
  if (!b || !h.sameIdList(h.idsOf(b.data).sort(), want)) return h.fail(res, `all ${want.length} records on one page`);
  const values = b.data.map((r) => r[field]);
  const desc = order === 'desc';
  const sorted = isText ? h.isSortedText(values, desc) : h.isSortedNumbers(values, desc);
  const words = desc ? 'non-increasing' : 'non-decreasing';
  return h.check(sorted, res, `${words} by ${field}${isText ? ' (ignoring letter case)' : ''}`, `values: ${JSON.stringify(values).slice(0, 150)}`);
}

module.exports = [
  { id: 'O01', name: 'sort=<amount> ascending', run: (ctx) => expectSorted(ctx, ctx.F.amount, null, false) },
  { id: 'O02', name: 'sort=<amount>&order=desc', run: (ctx) => expectSorted(ctx, ctx.F.amount, 'desc', false) },
  { id: 'O03', name: 'sort=<text1> ascending', run: (ctx) => expectSorted(ctx, ctx.F.text1, null, true) },
  { id: 'O04', name: 'sort=<count> ascending', run: (ctx) => expectSorted(ctx, ctx.F.count, null, false) },
  {
    id: 'O05',
    name: 'Invalid sort field (sort=banana)',
    async run(ctx) {
      const res = await ctx.list({ sort: 'banana' });
      return h.check(res.status === 400, res, '400');
    },
  },
  {
    id: 'O06',
    name: 'Invalid order (order=sideways)',
    async run(ctx) {
      const res = await ctx.list({ sort: ctx.F.amount, order: 'sideways' });
      return h.check(res.status === 400, res, '400');
    },
  },
];
