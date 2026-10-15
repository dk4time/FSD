// Library Books API (Practice Set P2) - Express, in-memory, no database.
const express = require('express');

const app = express();
app.use(express.json());

// ---------- data ----------
const books = []; // records in creation order
let nextId = 1;

const GENRES = ['Fiction', 'Science', 'History', 'Technology', 'Biography'];
const SORT_FIELDS = ['title', 'price', 'copies'];

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
  author: (b) => checkText(b, 'author', 2, 40),
  genre: (b) => {
    if (typeof b.genre !== 'string' || !GENRES.includes(b.genre)) {
      return { error: `genre must be one of ${GENRES.join(', ')}` };
    }
    return { value: b.genre };
  },
  price: (b) => {
    const v = b.price;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'price must be a number' };
    if (v <= 0) return { error: 'price must be greater than 0' };
    if (v > 10000) return { error: 'price must be at most 10000' };
    return { value: v };
  },
  copies: (b) => {
    const v = b.copies;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'copies must be a whole number' };
    if (v < 0 || v > 500) return { error: 'copies must be from 0 to 500' };
    return { value: v };
  },
  available: (b) => {
    if (typeof b.available !== 'boolean') return { error: 'available must be true or false' };
    return { value: b.available };
  },
  isbn: (b) => checkText(b, 'isbn', 4, 20),
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

// isbn is unique ignoring letter case; the record with id exceptId may keep its own value
function isbnTaken(isbn, exceptId) {
  const wanted = isbn.toLowerCase();
  return books.some((b) => b.id !== exceptId && b.isbn.toLowerCase() === wanted);
}

function findIndex(id) {
  return books.findIndex((b) => String(b.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    title: data.title,
    author: data.author,
    genre: data.genre,
    price: data.price,
    copies: data.copies,
    available: data.available,
    isbn: data.isbn,
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

function notFound(res) {
  return res.status(404).json({ error: 'Record not found' });
}

// ---------- routes ----------
app.post('/api/books', (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (isbnTaken(r.value.isbn, null)) return res.status(409).json({ error: 'isbn already exists' });
  const record = toRecord(nextId++, r.value);
  books.push(record);
  res.status(201).json(record);
});

app.get('/api/books', (req, res) => {
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
  if (q.available !== undefined && q.available !== 'true' && q.available !== 'false') {
    return badRequest(res, 'available must be true or false');
  }
  let minPrice = null;
  if (q.minPrice !== undefined) {
    minPrice = parseNumber(q.minPrice);
    if (minPrice === null) return badRequest(res, 'minPrice must be a number');
  }
  let maxPrice = null;
  if (q.maxPrice !== undefined) {
    maxPrice = parseNumber(q.maxPrice);
    if (maxPrice === null) return badRequest(res, 'maxPrice must be a number');
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
  let list = books.filter((b) => {
    if (q.genre !== undefined && b.genre !== q.genre) return false;
    if (q.available !== undefined && b.available !== (q.available === 'true')) return false;
    if (minPrice !== null && b.price < minPrice) return false;
    if (maxPrice !== null && b.price > maxPrice) return false;
    return true;
  });

  // 2. search on title or author (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== '') {
    const term = q.search.toLowerCase();
    list = list.filter((b) => b.title.toLowerCase().includes(term) || b.author.toLowerCase().includes(term));
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

app.get('/api/books/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  res.json(books[i]);
});

app.put('/api/books/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (isbnTaken(r.value.isbn, books[i].id)) return res.status(409).json({ error: 'isbn already exists' });
  books[i] = toRecord(books[i].id, r.value);
  res.json(books[i]);
});

app.patch('/api/books/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  if (r.value.isbn !== undefined && isbnTaken(r.value.isbn, books[i].id)) {
    return res.status(409).json({ error: 'isbn already exists' });
  }
  books[i] = toRecord(books[i].id, { ...books[i], ...r.value });
  res.json(books[i]);
});

app.delete('/api/books/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  books.splice(i, 1);
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
  console.log(`Library Books API listening on port ${PORT}`);
});
