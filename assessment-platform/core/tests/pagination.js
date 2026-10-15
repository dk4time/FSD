'use strict';
const h = require('./_helpers');

async function expectPage(ctx, params, label) {
  const res = await ctx.list(params);
  const b = h.listBody(res);
  const want = ctx.model.query(params).data.map((r) => String(r.id));
  return h.check(b && h.sameIdList(h.idsOf(b.data), want), res, `${label}: ids ${want.join(', ') || '(none)'}`);
}

async function must400(ctx, cases) {
  for (const params of cases) {
    const res = await ctx.list(params);
    if (res.status !== 400) return h.fail(res, '400');
  }
  return h.pass();
}

module.exports = [
  {
    id: 'G01',
    name: 'limit=5',
    async run(ctx) {
      const res = await ctx.list({ limit: 5 });
      const b = h.listBody(res);
      return h.check(b && b.data.length === 5, res, 'exactly 5 items');
    },
  },
  {
    id: 'G02',
    name: 'page=2&limit=5',
    async run(ctx) {
      return expectPage(ctx, { page: 2, limit: 5 }, 'items 6-10 in creation order');
    },
  },
  {
    id: 'G03',
    name: 'Page 1 and page 2',
    async run(ctx) {
      const r1 = await ctx.list({ page: 1, limit: 5 });
      const r2 = await ctx.list({ page: 2, limit: 5 });
      const b1 = h.listBody(r1);
      const b2 = h.listBody(r2);
      if (!b1 || !b2 || b1.data.length === 0 || b2.data.length === 0) return h.fail(b1 ? r2 : r1, 'two non-empty pages');
      const ids1 = new Set(h.idsOf(b1.data));
      return h.check(!h.idsOf(b2.data).some((id) => ids1.has(id)), r2, 'no id on both page 1 and page 2');
    },
  },
  {
    id: 'G04',
    name: 'Last page',
    async run(ctx) {
      const limit = 7;
      const last = Math.max(1, Math.ceil(ctx.model.size / limit));
      return expectPage(ctx, { page: last, limit }, `page ${last} with limit ${limit} holds the remainder`);
    },
  },
  {
    id: 'G05',
    name: 'totalPages',
    async run(ctx) {
      const want = ctx.model.query({ limit: 7 }).totalPages;
      const res = await ctx.list({ limit: 7 });
      const b = h.listBody(res);
      return h.check(b && b.totalPages === want, res, `totalPages = ${want} (total ${ctx.model.size}, limit 7)`);
    },
  },
  {
    id: 'G06',
    name: 'Walk every page (limit=10)',
    async run(ctx) {
      const all = await ctx.listAll(10);
      if (!all.ok) return h.fail(all.res, 'every page readable');
      const want = ctx.model.ids().map(String);
      const seen = new Map();
      for (const id of all.ids) seen.set(id, (seen.get(id) || 0) + 1);
      const missing = want.filter((id) => seen.get(id) !== 1);
      const ok = missing.length === 0 && all.ids.length === want.length;
      return h.check(ok, all.res, `each of the ${want.length} records exactly once across all pages`, missing.length ? `missing or repeated: ${missing.slice(0, 10).join(', ')}` : `read ${all.ids.length} items`);
    },
  },
  {
    id: 'G07',
    name: 'page beyond the last page',
    async run(ctx) {
      const page = Math.ceil(ctx.model.size / 10) + 1;
      const res = await ctx.list({ page });
      const b = h.listBody(res);
      return h.check(b && b.data.length === 0, res, `200 with empty data for page ${page}`);
    },
  },
  { id: 'G08', name: 'page=0', run: (ctx) => must400(ctx, [{ page: 0 }]) },
  { id: 'G09', name: 'page=-1', run: (ctx) => must400(ctx, [{ page: -1 }]) },
  { id: 'G10', name: 'limit=0', run: (ctx) => must400(ctx, [{ limit: 0 }]) },
  {
    id: 'G11',
    name: 'limit=51 (maximum is 50)',
    async run(ctx) {
      const r51 = await ctx.list({ limit: 51 });
      if (r51.status !== 400) return h.fail(r51, '400 for limit=51');
      const r50 = await ctx.list({ limit: 50 });
      const b = h.listBody(r50);
      const want = Math.min(50, ctx.model.size);
      return h.check(b && b.data.length === want, r50, `200 with ${want} items for limit=50`);
    },
  },
  { id: 'G12', name: 'Non-integers', run: (ctx) => must400(ctx, [{ page: 'abc' }, { limit: 1.5 }]) },
];
