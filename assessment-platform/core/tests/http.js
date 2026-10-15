'use strict';
const h = require('./_helpers');

module.exports = [
  {
    id: 'H01',
    name: 'JSON responses',
    async run(ctx) {
      const list = await ctx.list({});
      if (!h.isJsonType(list)) return h.fail(list, 'list response Content-Type application/json', `Content-Type "${list.contentType}"`);
      const created = ctx.seed.results[0] && ctx.seed.results[0].res;
      if (!h.isJsonType(created)) return h.fail(created, 'create response Content-Type application/json', `Content-Type "${created ? created.contentType : ''}"`);
      const err = await ctx.getOne(h.UNKNOWN_NUMERIC_ID);
      return h.check(h.isJsonType(err), err, 'error response Content-Type application/json', `Content-Type "${err.contentType}"`);
    },
  },
  {
    id: 'H02',
    name: 'Unknown route (/api/nothing)',
    async run(ctx) {
      const res = await ctx.rootGet('/api/nothing');
      return h.check(res.status === 404 && h.isErrorBody(res), res, '404 + JSON body with a non-empty "error" or "message"');
    },
  },
];
