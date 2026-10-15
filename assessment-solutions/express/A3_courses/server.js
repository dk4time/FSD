// Online Courses API (Assessment Set A3) - Express, in-memory, no database.
const express = require('express');

const app = express();
app.use(express.json());

// ---------- data ----------
const courses = []; // records in creation order
let nextId = 1;

const CATEGORIES = ['Programming', 'Design', 'Data', 'Business', 'Marketing'];
const SORT_FIELDS = ['title', 'fee', 'durationHours'];

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
  title: (b) => checkText(b, 'title', 3, 60),
  instructor: (b) => checkText(b, 'instructor', 2, 40),
  category: (b) => {
    if (typeof b.category !== 'string' || !CATEGORIES.includes(b.category)) {
      return { error: `category must be one of ${CATEGORIES.join(', ')}` };
    }
    return { value: b.category };
  },
  fee: (b) => {
    const v = b.fee;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'fee must be a number' };
    if (v <= 0) return { error: 'fee must be greater than 0' };
    if (v > 200000) return { error: 'fee must be at most 200000' };
    return { value: v };
  },
  durationHours: (b) => {
    const v = b.durationHours;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'durationHours must be a whole number' };
    if (v < 1 || v > 1000) return { error: 'durationHours must be from 1 to 1000' };
    return { value: v };
  },
  published: (b) => {
    if (typeof b.published !== 'boolean') return { error: 'published must be true or false' };
    return { value: b.published };
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
  return courses.findIndex((p) => String(p.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    title: data.title,
    instructor: data.instructor,
    category: data.category,
    fee: data.fee,
    durationHours: data.durationHours,
    published: data.published,
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
app.post('/api/courses', (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  const record = toRecord(nextId++, r.value);
  courses.push(record);
  res.status(201).json(record);
});

app.get('/api/courses', (req, res) => {
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
  if (q.published !== undefined && q.published !== 'true' && q.published !== 'false') {
    return badRequest(res, 'published must be true or false');
  }
  let minFee = null;
  if (q.minFee !== undefined) {
    minFee = parseNumber(q.minFee);
    if (minFee === null) return badRequest(res, 'minFee must be a number');
  }
  let maxFee = null;
  if (q.maxFee !== undefined) {
    maxFee = parseNumber(q.maxFee);
    if (maxFee === null) return badRequest(res, 'maxFee must be a number');
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
  let list = courses.filter((p) => {
    if (q.category !== undefined && p.category !== q.category) return false;
    if (q.published !== undefined && p.published !== (q.published === 'true')) return false;
    if (minFee !== null && p.fee < minFee) return false;
    if (maxFee !== null && p.fee > maxFee) return false;
    return true;
  });

  // 2. search (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== '') {
    const term = q.search.toLowerCase();
    list = list.filter((p) => p.title.toLowerCase().includes(term) || p.instructor.toLowerCase().includes(term));
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

app.get('/api/courses/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  res.json(courses[i]);
});

app.put('/api/courses/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  courses[i] = toRecord(courses[i].id, r.value);
  res.json(courses[i]);
});

app.patch('/api/courses/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  courses[i] = toRecord(courses[i].id, { ...courses[i], ...r.value });
  res.json(courses[i]);
});

app.delete('/api/courses/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  courses.splice(i, 1);
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
  console.log(`Online Courses API listening on port ${PORT}`);
});
