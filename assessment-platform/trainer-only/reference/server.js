'use strict';
// Correct implementation of the HTTP contract (prompt section 5), written from the contract only.
// It deliberately does NOT import anything from core/, so a misreading in the evaluator cannot
// hide behind a shared bug. Data lives in memory only.
//
//   SET_ID=P1 PORT=8080 node trainer-only/reference/server.js
//   MUTANT=M07 ...   switches on exactly one deliberate bug (see MUTANTS below)

const express = require('express');
const fs = require('fs');
const path = require('path');

const MUTANTS = {
  M01: 'no-validation',
  M02: 'create-returns-200',
  M03: 'put-creates-missing',
  M04: 'patch-is-put',
  M05: 'delete-returns-200-json',
  M06: 'delete-is-soft',
  M07: 'page-offset-bug',
  M08: 'no-max-limit',
  M09: 'search-case-sensitive',
  M10: 'search-first-field-only',
  M11: 'range-exclusive',
  M12: 'sort-amount-as-string',
  M13: 'sort-case-sensitive',
  M14: 'total-is-page-length',
  M15: 'default-limit-20',
  M16: 'bad-json-crashes',
  M17: 'html-404',
  M18: 'no-trim',
  M19: 'stores-unknown-fields',
  M20: 'id-mutable',
  M21: 'unique-case-sensitive',
  M22: 'no-uniqueness',
  M23: 'wrongly-unique-text1',
  M24: 'patch-empty-ok',
  M25: 'boolean-as-string',
  M26: 'page-zero-ok',
  M27: 'flag-false-ignored',
  M28: 'total-pages-floor',
  M29: 'sort-ignores-order',
  M30: 'combined-or',
  M31: 'default-order-reversed',
};

function loadConfig(setId) {
  const file = path.join(__dirname, '..', '..', 'domains', `${setId}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createApp(cfg, mutant = '') {
  const bug = (id) => mutant === id;
  const T1 = cfg.text1;
  const T2 = cfg.text2;
  const EN = cfg.enum;
  const AM = cfg.amount;
  const CN = cfg.count;
  const FL = cfg.flag;
  const UC = cfg.uniqueCode;
  const FIELDS = [T1.name, T2.name, EN.name, AM.name, CN.name, FL.name].concat(UC ? [UC.name] : []);
  const base = `/api/${cfg.resource}`;

  let records = [];
  let nextId = 1;

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const sendError = (res, status, message) => res.status(status).json({ error: message });
  const notFound = (res, message) => {
    if (bug('M17')) return res.status(404).type('html').send('<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>');
    return sendError(res, 404, message);
  };
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const findIndex = (id) => records.findIndex((r) => String(r.id) === String(id));

  // returns { error } or { value } for one field
  function validateField(name, v) {
    const text = (spec) => {
      if (typeof v !== 'string') return { error: `${name} must be a string` };
      const t = v.trim();
      if (t.length < spec.minLen || t.length > spec.maxLen) return { error: `${name} must be ${spec.minLen}-${spec.maxLen} characters` };
      return { value: bug('M18') ? v : t };
    };
    if (name === T1.name) return text(T1);
    if (name === T2.name) return text(T2);
    if (UC && name === UC.name) return text(UC);
    if (name === EN.name) {
      if (typeof v !== 'string' || !EN.values.includes(v)) return { error: `${name} must be one of ${EN.values.join(', ')}` };
      return { value: v };
    }
    if (name === AM.name) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > AM.max) return { error: `${name} must be a number greater than 0 and at most ${AM.max}` };
      return { value: v };
    }
    if (name === CN.name) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < CN.min || v > CN.max) return { error: `${name} must be a whole number from ${CN.min} to ${CN.max}` };
      return { value: v };
    }
    if (name === FL.name) {
      if (bug('M25') && (v === 'true' || v === 'yes')) return { value: true };
      if (typeof v !== 'boolean') return { error: `${name} must be true or false` };
      return { value: v };
    }
    return { error: `unknown field ${name}` };
  }

  // validates the listed fields of body; all of them are required when `required` is true
  function validate(body, names, required) {
    const value = {};
    for (const name of names) {
      if (body[name] === undefined || body[name] === null) {
        if (required && !bug('M01')) return { error: `${name} is required` };
        continue;
      }
      if (bug('M01')) {
        value[name] = typeof body[name] === 'string' ? body[name].trim() : body[name];
        continue;
      }
      const r = validateField(name, body[name]);
      if (r.error) return r;
      value[name] = r.value;
    }
    return { value };
  }

  function unknownFields(body) {
    const out = {};
    for (const k of Object.keys(body)) if (!FIELDS.includes(k) && k !== 'id') out[k] = body[k];
    return out;
  }

  function codeTaken(code, exceptId) {
    if (!UC || bug('M22') || typeof code !== 'string') return false;
    const norm = (s) => (bug('M21') ? String(s).trim() : String(s).trim().toLowerCase());
    return records.some((r) => String(r.id) !== String(exceptId) && r[UC.name] !== undefined && norm(r[UC.name]) === norm(code));
  }

  // ---- list --------------------------------------------------------------------------------
  app.get(base, (req, res) => {
    const q = req.query;
    const one = (k) => (q[k] === undefined ? undefined : typeof q[k] === 'string' ? q[k] : null);
    const posInt = (s) => /^\d+$/.test(s) && Number(s) >= 1;

    let page = 1;
    const p = one('page');
    if (p !== undefined) {
      if (p !== null && posInt(p)) page = Number(p);
      else if (bug('M26') && p !== null && /^-?\d+$/.test(p) && Number(p) <= 0) page = 1;
      else return sendError(res, 400, 'page must be a positive integer');
    }

    let limit = bug('M15') ? 20 : 10;
    const l = one('limit');
    if (l !== undefined) {
      if (l === null || !posInt(l) || (Number(l) > 50 && !bug('M08'))) return sendError(res, 400, 'limit must be an integer from 1 to 50');
      limit = Number(l);
    }

    const filters = [];
    const e = one(EN.name);
    if (e !== undefined) {
      if (e === null || !EN.values.includes(e)) return sendError(res, 400, `${EN.name} must be one of ${EN.values.join(', ')}`);
      filters.push((r) => r[EN.name] === e);
    }
    const f = one(FL.name);
    if (f !== undefined) {
      if (f !== 'true' && f !== 'false') return sendError(res, 400, `${FL.name} must be true or false`);
      if (!(bug('M27') && f === 'false')) filters.push((r) => r[FL.name] === (f === 'true'));
    }
    const [minP, maxP] = AM.rangeFilter;
    for (const [param, isMin] of [[minP, true], [maxP, false]]) {
      const v = one(param);
      if (v === undefined) continue;
      if (v === null || v.trim() === '' || !Number.isFinite(Number(v))) return sendError(res, 400, `${param} must be a number`);
      const n = Number(v);
      if (bug('M11')) filters.push(isMin ? (r) => r[AM.name] > n : (r) => r[AM.name] < n);
      else filters.push(isMin ? (r) => r[AM.name] >= n : (r) => r[AM.name] <= n);
    }

    const s = one('search');
    if (s === null) return sendError(res, 400, 'search must be a single value');
    let searchFn = null;
    if (s !== undefined && s !== '') {
      const fields = bug('M10') ? [T1.name] : [T1.name, T2.name];
      if (bug('M09')) searchFn = (r) => fields.some((k) => String(r[k]).includes(s));
      else searchFn = (r) => fields.some((k) => String(r[k]).toLowerCase().includes(s.toLowerCase()));
    }

    const sort = one('sort');
    if (sort !== undefined && (sort === null || !cfg.sortFields.includes(sort))) return sendError(res, 400, `sort must be one of ${cfg.sortFields.join(', ')}`);
    const order = one('order');
    if (order !== undefined && order !== 'asc' && order !== 'desc') return sendError(res, 400, 'order must be asc or desc');

    // filter -> search -> sort -> paginate
    const filterOk = (r) => filters.every((fn) => fn(r));
    let items;
    if (bug('M30') && searchFn && filters.length) items = records.filter((r) => searchFn(r) || filterOk(r));
    else items = records.filter((r) => filterOk(r) && (!searchFn || searchFn(r)));

    if (sort) {
      const desc = order === 'desc' && !bug('M29');
      let cmp;
      if (sort === T1.name) {
        const key = (r) => (bug('M13') ? String(r[sort]) : String(r[sort]).toLowerCase());
        cmp = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
      } else if (sort === AM.name && bug('M12')) {
        cmp = (a, b) => (String(a[sort]) < String(b[sort]) ? -1 : String(a[sort]) > String(b[sort]) ? 1 : 0);
      } else {
        cmp = (a, b) => a[sort] - b[sort];
      }
      items = items.slice().sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
    } else if (bug('M31')) {
      items = items.slice().reverse();
    }

    const offset = bug('M07') ? page * limit : (page - 1) * limit;
    const data = items.slice(offset, offset + limit);
    const total = bug('M14') ? data.length : items.length;
    const totalPages = total === 0 ? 0 : bug('M28') ? Math.floor(total / limit) : Math.ceil(total / limit);
    res.json({ data, page, limit, total, totalPages });
  });

  // ---- create --------------------------------------------------------------------------------
  app.post(base, (req, res) => {
    const body = req.body;
    if (!isPlainObject(body)) return sendError(res, 400, 'body must be a JSON object');
    const v = validate(body, FIELDS, true);
    if (v.error) return sendError(res, 400, v.error);
    if (UC && codeTaken(v.value[UC.name])) return sendError(res, 409, `${UC.name} already exists`);
    if (bug('M23') && !UC) {
      const t = String(v.value[T1.name] || '').trim().toLowerCase();
      if (records.some((r) => String(r[T1.name]).trim().toLowerCase() === t)) return sendError(res, 409, `${T1.name} already exists`);
    }
    const rec = { id: nextId++, ...v.value, ...(bug('M19') ? unknownFields(body) : {}) };
    records.push(rec);
    res.status(bug('M02') ? 200 : 201).json(rec);
  });

  // ---- read one ----------------------------------------------------------------------------
  app.get(`${base}/:id`, (req, res) => {
    const i = findIndex(req.params.id);
    if (i < 0) return notFound(res, `no record with id ${req.params.id}`);
    res.json(records[i]);
  });

  // ---- replace -----------------------------------------------------------------------------
  app.put(`${base}/:id`, (req, res) => {
    const body = req.body;
    const i = findIndex(req.params.id);
    if (i < 0 && !bug('M03')) return notFound(res, `no record with id ${req.params.id}`);
    if (!isPlainObject(body)) return sendError(res, 400, 'body must be a JSON object');
    const v = validate(body, FIELDS, true);
    if (v.error) return sendError(res, 400, v.error);
    const ownId = i >= 0 ? records[i].id : req.params.id;
    if (UC && codeTaken(v.value[UC.name], ownId)) return sendError(res, 409, `${UC.name} already exists`);
    const newId = bug('M20') && body.id !== undefined ? body.id : ownId;
    const rec = { id: newId, ...v.value, ...(bug('M19') ? unknownFields(body) : {}) };
    if (i < 0) {
      records.push(rec);
      return res.status(201).json(rec);
    }
    records[i] = rec;
    res.json(rec);
  });

  // ---- partial update ----------------------------------------------------------------------
  app.patch(`${base}/:id`, (req, res) => {
    const body = req.body;
    const i = findIndex(req.params.id);
    if (i < 0) return notFound(res, `no record with id ${req.params.id}`);
    if (!isPlainObject(body)) return sendError(res, 400, 'body must be a JSON object');
    const sent = FIELDS.filter((k) => body[k] !== undefined);
    if (sent.length === 0) {
      if (bug('M24')) return res.json(records[i]);
      return sendError(res, 400, `send at least one of ${FIELDS.join(', ')}`);
    }
    const v = validate(body, sent, false);
    if (v.error) return sendError(res, 400, v.error);
    if (UC && v.value[UC.name] !== undefined && codeTaken(v.value[UC.name], records[i].id)) return sendError(res, 409, `${UC.name} already exists`);
    const old = records[i];
    const newId = bug('M20') && body.id !== undefined ? body.id : old.id;
    const merged = bug('M04') ? { id: newId, ...v.value } : { ...old, ...v.value, id: newId };
    if (bug('M19')) Object.assign(merged, unknownFields(body));
    records[i] = merged;
    res.json(merged);
  });

  // ---- delete ------------------------------------------------------------------------------
  app.delete(`${base}/:id`, (req, res) => {
    const i = findIndex(req.params.id);
    if (i < 0) return notFound(res, `no record with id ${req.params.id}`);
    if (bug('M06')) return res.status(204).end();
    const [removed] = records.splice(i, 1);
    if (bug('M05')) return res.status(200).json({ message: 'deleted', id: removed.id });
    res.status(204).end();
  });

  // ---- fallbacks ---------------------------------------------------------------------------
  app.use((req, res) => notFound(res, `no route ${req.method} ${req.path}`));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      if (bug('M16')) return res.status(500).type('html').send('<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1></body></html>');
      return sendError(res, 400, 'malformed JSON body');
    }
    if (err && err.status >= 400 && err.status < 500) return sendError(res, err.status, err.message || 'bad request');
    sendError(res, 500, 'internal server error');
  });

  return app;
}

if (require.main === module) {
  const setId = (process.env.SET_ID || 'P1').toUpperCase();
  const mutant = (process.env.MUTANT || '').toUpperCase();
  const port = Number(process.env.PORT) || 8080;
  if (mutant && !MUTANTS[mutant]) {
    console.error(`Unknown MUTANT ${mutant}. Use one of ${Object.keys(MUTANTS).join(', ')}`);
    process.exit(1);
  }
  const cfg = loadConfig(setId);
  const app = createApp(cfg, mutant);
  app.listen(port, () => {
    console.log(`reference ${setId}${mutant ? ` mutant ${mutant} (${MUTANTS[mutant]})` : ''} listening on http://localhost:${port}/api/${cfg.resource}`);
  });
}

module.exports = { createApp, loadConfig, MUTANTS };
