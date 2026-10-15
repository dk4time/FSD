'use strict';
const h = require('./_helpers');

async function deleteScratch(ctx) {
  const rec = await ctx.scratch();
  const res = await ctx.del(rec.id);
  if (res.status >= 200 && res.status < 300) ctx.model.remove(rec.id);
  return { rec, res };
}

module.exports = [
  {
    id: 'D01',
    name: 'DELETE an existing record',
    async run(ctx) {
      const { res } = await deleteScratch(ctx);
      return h.check(res.status === 204, res, '204 No Content');
    },
  },
  {
    id: 'D02',
    name: '204 response has an empty body',
    async run(ctx) {
      const { res } = await deleteScratch(ctx);
      return h.check(res.status === 204 && res.text === '', res, '204 with an empty body');
    },
  },
  {
    id: 'D03',
    name: 'GET after DELETE',
    async run(ctx) {
      const { rec, res } = await deleteScratch(ctx);
      if (res.status < 200 || res.status >= 300) return h.fail(res, '2xx for the DELETE');
      const got = await ctx.getOne(rec.id);
      return h.check(got.status === 404, got, '404');
    },
  },
  {
    id: 'D04',
    name: 'DELETE the same id again',
    async run(ctx) {
      const { rec, res } = await deleteScratch(ctx);
      if (res.status < 200 || res.status >= 300) return h.fail(res, '2xx for the first DELETE');
      const again = await ctx.del(rec.id);
      return h.check(again.status === 404, again, '404');
    },
  },
  {
    id: 'D05',
    name: 'DELETE an unknown id',
    async run(ctx) {
      for (const id of [h.UNKNOWN_NUMERIC_ID, h.UNKNOWN_STRING_ID]) {
        const res = await ctx.del(id);
        if (res.status !== 404) return h.fail(res, '404');
      }
      return h.pass();
    },
  },
  {
    id: 'D06',
    name: 'List total after DELETE',
    async run(ctx) {
      const rec = await ctx.scratch();
      const before = await ctx.serverTotal();
      if (before.total === null) return h.fail(before.res, 'list with a numeric total');
      const res = await ctx.del(rec.id);
      if (res.status >= 200 && res.status < 300) ctx.model.remove(rec.id);
      const after = await ctx.serverTotal();
      return h.check(after.total === before.total - 1, after.res, `total ${before.total - 1} (was ${before.total})`);
    },
  },
  {
    id: 'D07',
    name: 'Other records unaffected',
    async run(ctx) {
      const { res } = await deleteScratch(ctx);
      if (res.status < 200 || res.status >= 300) return h.fail(res, '2xx for the DELETE');
      return ctx.spotCheckSeeds(3);
    },
  },
  {
    id: 'D08',
    name: 'Deleted record absent from the full list',
    async run(ctx) {
      const { rec, res } = await deleteScratch(ctx);
      if (res.status < 200 || res.status >= 300) return h.fail(res, '2xx for the DELETE');
      const all = await ctx.listAll(50);
      if (!all.ok) return h.fail(all.res, 'every page of the list readable');
      return h.check(!all.ids.includes(String(rec.id)), all.res, `id ${rec.id} not in any page`);
    },
  },
];
