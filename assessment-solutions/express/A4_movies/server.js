// Movie Catalog API (Assessment Set A4) - Express, in-memory, no database.
const express = require('express');

const app = express();
app.use(express.json());

// ---------- data ----------
const movies = []; // records in creation order
let nextId = 1;

const GENRES = ['Action', 'Comedy', 'Drama', 'Thriller', 'SciFi'];
const SORT_FIELDS = ['title', 'rating', 'durationMinutes'];

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
  director: (b) => checkText(b, 'director', 2, 40),
  genre: (b) => {
    if (typeof b.genre !== 'string' || !GENRES.includes(b.genre)) {
      return { error: `genre must be one of ${GENRES.join(', ')}` };
    }
    return { value: b.genre };
  },
  rating: (b) => {
    const v = b.rating;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'rating must be a number' };
    if (v <= 0) return { error: 'rating must be greater than 0' };
    if (v > 10) return { error: 'rating must be at most 10' };
    return { value: v };
  },
  durationMinutes: (b) => {
    const v = b.durationMinutes;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'durationMinutes must be a whole number' };
    if (v < 1 || v > 600) return { error: 'durationMinutes must be from 1 to 600' };
    return { value: v };
  },
  nowShowing: (b) => {
    if (typeof b.nowShowing !== 'boolean') return { error: 'nowShowing must be true or false' };
    return { value: b.nowShowing };
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
  return movies.findIndex((p) => String(p.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    title: data.title,
    director: data.director,
    genre: data.genre,
    rating: data.rating,
    durationMinutes: data.durationMinutes,
    nowShowing: data.nowShowing,
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
app.post('/api/movies', (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  const record = toRecord(nextId++, r.value);
  movies.push(record);
  res.status(201).json(record);
});

app.get('/api/movies', (req, res) => {
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

  if (q.genre !== undefined && !GENRES.includes(q.genre)) {
    return badRequest(res, 'genre is not valid');
  }
  if (q.nowShowing !== undefined && q.nowShowing !== 'true' && q.nowShowing !== 'false') {
    return badRequest(res, 'nowShowing must be true or false');
  }
  let minRating = null;
  if (q.minRating !== undefined) {
    minRating = parseNumber(q.minRating);
    if (minRating === null) return badRequest(res, 'minRating must be a number');
  }
  let maxRating = null;
  if (q.maxRating !== undefined) {
    maxRating = parseNumber(q.maxRating);
    if (maxRating === null) return badRequest(res, 'maxRating must be a number');
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
  let list = movies.filter((p) => {
    if (q.genre !== undefined && p.genre !== q.genre) return false;
    if (q.nowShowing !== undefined && p.nowShowing !== (q.nowShowing === 'true')) return false;
    if (minRating !== null && p.rating < minRating) return false;
    if (maxRating !== null && p.rating > maxRating) return false;
    return true;
  });

  // 2. search (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== '') {
    const term = q.search.toLowerCase();
    list = list.filter((p) => p.title.toLowerCase().includes(term) || p.director.toLowerCase().includes(term));
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

app.get('/api/movies/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  res.json(movies[i]);
});

app.put('/api/movies/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  movies[i] = toRecord(movies[i].id, r.value);
  res.json(movies[i]);
});

app.patch('/api/movies/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  movies[i] = toRecord(movies[i].id, { ...movies[i], ...r.value });
  res.json(movies[i]);
});

app.delete('/api/movies/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Record not found' });
  movies.splice(i, 1);
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
  console.log(`Movie Catalog API listening on port ${PORT}`);
});
