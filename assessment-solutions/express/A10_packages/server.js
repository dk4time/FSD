// Travel Packages API (Assessment Set A10) - Express, in-memory, no database.
const express = require('express');

const app = express();
app.use(express.json());

// ---------- data ----------
const packages = []; // records in creation order
let nextId = 1;

const CATEGORIES = ['Beach', 'Hill', 'Heritage', 'Adventure', 'Pilgrimage'];
const SORT_FIELDS = ['name', 'pricePerPerson', 'durationDays'];

// ---------- validation helpers ----------
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Each checker returns { value } when valid or { error } when not.
function checkText(body, field, min, max) {
  const v = body[field];
  if (typeof v !== 'string') return { error: `${field} must be a string` };
  const t = v.trim();
  if (t.length === 0) return { error: `${field} must not be blank` };
  if (t.length < min || t.length > max) return { error: `${field} must be ${min} to ${max} characters` };
  return { value: t };
}

const validators = {
  name: (b) => checkText(b, 'name', 3, 60),
  destination: (b) => checkText(b, 'destination', 2, 40),
  category: (b) => {
    if (typeof b.category !== 'string' || !CATEGORIES.includes(b.category)) {
      return { error: `category must be one of ${CATEGORIES.join(', ')}` };
    }
    return { value: b.category };
  },
  pricePerPerson: (b) => {
    const v = b.pricePerPerson;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'pricePerPerson must be a number' };
    if (v <= 0) return { error: 'pricePerPerson must be greater than 0' };
    if (v > 200000) return { error: 'pricePerPerson must be at most 200000' };
    return { value: v };
  },
  durationDays: (b) => {
    const v = b.durationDays;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'durationDays must be a whole number' };
    if (v < 1 || v > 60) return { error: 'durationDays must be from 1 to 60' };
    return { value: v };
  },
  includesFlight: (b) => {
    if (typeof b.includesFlight !== 'boolean') return { error: 'includesFlight must be true or false' };
    return { value: b.includesFlight };
  },
};
const FIELDS = Object.keys(validators);

// partial = true for PATCH: only validate the fields that were sent.
function validateBody(body, partial) {
  if (!isPlainObject(body)) return { error: 'Request body must be a JSON object' };
  const clean = {};
  let sent = 0;
  for (const field of FIELDS) {
    if (!(field in body)) {
      if (partial) continue;
      return { error: `${field} is required` };
    }
    sent++;
    const r = validators[field](body);
    if (r.error) return { error: r.error };
    clean[field] = r.value;
  }
  if (partial && sent === 0) return { error: 'Send at least one field to update' };
  return { value: clean };
}

function findIndex(id) {
  return packages.findIndex((p) => String(p.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    name: data.name,
    destination: data.destination,
    category: data.category,
    pricePerPerson: data.pricePerPerson,
    durationDays: data.durationDays,
    includesFlight: data.includesFlight,
  };
}

// ---------- query helpers ----------
// Returns a number or null when the text is not a positive whole number.
function parsePositiveInt(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 ? n : null;
}

function parseNumber(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

// ---------- routes ----------
app.post('/api/packages', (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  const record = toRecord(nextId++, r.value);
  packages.push(record);
  res.status(201).json(record);
});

app.get('/api/packages', (req, res) => {
  const q = req.query;

  let page = 1;
  if (q.page !== undefined) {
    page = parsePositiveInt(q.page);
    if (page === null) return badRequest(res, 'page must be a positive integer');
  }
  let limit = 10;
  if (q.limit !== undefined) {
    limit = parsePositiveInt(q.limit);
    if (limit === null || limit > 50) return badRequest(res, 'limit must be a positive integer up to 50');
  }

  if (q.category !== undefined && !CATEGORIES.includes(q.category)) {
    return badRequest(res, 'category is not valid');
  }
  if (q.includesFlight !== undefined && q.includesFlight !== 'true' && q.includesFlight !== 'false') {
    return badRequest(res, 'includesFlight must be true or false');
  }
  let minPricePerPerson = null;
  if (q.minPricePerPerson !== undefined) {
    minPricePerPerson = parseNumber(q.minPricePerPerson);
    if (minPricePerPerson === null) return badRequest(res, 'minPricePerPerson must be a number');
  }
  let maxPricePerPerson = null;
  if (q.maxPricePerPerson !== undefined) {
    maxPricePerPerson = parseNumber(q.maxPricePerPerson);
    if (maxPricePerPerson === null) return badRequest(res, 'maxPricePerPerson must be a number');
  }
  if (q.sort !== undefined && !SORT_FIELDS.includes(q.sort)) {
    return badRequest(res, `sort must be one of ${SORT_FIELDS.join(', ')}`);
  }
  if (q.order !== undefined && q.order !== 'asc' && q.order !== 'desc') {
    return badRequest(res, 'order must be asc or desc');
  }
  if (q.search !== undefined && typeof q.search !== 'string') {
    return badRequest(res, 'search must be text');
  }

  // 1. filters
  let list = packages.filter((p) => {
    if (q.category !== undefined && p.category !== q.category) return false;
    if (q.includesFlight !== undefined && p.includesFlight !== (q.includesFlight === 'true')) return false;
    if (minPricePerPerson !== null && p.pricePerPerson < minPricePerPerson) return false;
    if (maxPricePerPerson !== null && p.pricePerPerson > maxPricePerPerson) return false;
    return true;
  });

  // 2. search (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== '') {
    const term = q.search.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(term) || p.destination.toLowerCase().includes(term));
  }

  // 3. sort (Array.prototype.sort is stable, so ties keep creation order)
  if (q.sort !== undefined) {
    const field = q.sort;
    const dir = q.order === 'desc' ? -1 : 1;
    list = [...list].sort((a, b) => {
      let x = a[field];
      let y = b[field];
      if (typeof x === 'string') {
        x = x.toLowerCase();
        y = y.toLowerCase();
      }
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
  }

  // 4. pagination
  const total = list.length;
  const start = (page - 1) * limit;
  res.json({
    data: list.slice(start, start + limit),
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  });
});

app.get('/api/packages/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  res.json(packages[i]);
});

app.put('/api/packages/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  packages[i] = toRecord(packages[i].id, r.value);
  res.json(packages[i]);
});

app.patch('/api/packages/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  packages[i] = toRecord(packages[i].id, { ...packages[i], ...r.value });
  res.json(packages[i]);
});

app.delete('/api/packages/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  packages.splice(i, 1);
  res.status(204).end();
});

// Unknown route -> JSON 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Malformed JSON (and any other error) -> JSON, never an HTML page
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message || 'Bad request' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Travel Packages API listening on port ${PORT}`);
});
