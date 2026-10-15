// Car Rental API (Assessment Set A7) - Express, in-memory, no database.
const express = require('express');

const app = express();
app.use(express.json());

// ---------- data ----------
const vehicles = []; // records in creation order
let nextId = 1;

const TYPES = ['Hatchback', 'Sedan', 'SUV', 'Van', 'Bike'];
const SORT_FIELDS = ['model', 'rentPerDay', 'seats'];

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
  model: (b) => checkText(b, 'model', 3, 60),
  brand: (b) => checkText(b, 'brand', 2, 40),
  type: (b) => {
    if (typeof b.type !== 'string' || !TYPES.includes(b.type)) {
      return { error: `type must be one of ${TYPES.join(', ')}` };
    }
    return { value: b.type };
  },
  rentPerDay: (b) => {
    const v = b.rentPerDay;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'rentPerDay must be a number' };
    if (v <= 0) return { error: 'rentPerDay must be greater than 0' };
    if (v > 50000) return { error: 'rentPerDay must be at most 50000' };
    return { value: v };
  },
  seats: (b) => {
    const v = b.seats;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'seats must be a whole number' };
    if (v < 1 || v > 60) return { error: 'seats must be from 1 to 60' };
    return { value: v };
  },
  available: (b) => {
    if (typeof b.available !== 'boolean') return { error: 'available must be true or false' };
    return { value: b.available };
  },
  registrationNumber: (b) => checkText(b, 'registrationNumber', 4, 20),
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

// registrationNumber is unique ignoring letter case; the record with id exceptId may keep its own value
function registrationNumberTaken(registrationNumber, exceptId) {
  const wanted = registrationNumber.toLowerCase();
  return vehicles.some((b) => b.id !== exceptId && b.registrationNumber.toLowerCase() === wanted);
}

function findIndex(id) {
  return vehicles.findIndex((b) => String(b.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    model: data.model,
    brand: data.brand,
    type: data.type,
    rentPerDay: data.rentPerDay,
    seats: data.seats,
    available: data.available,
    registrationNumber: data.registrationNumber,
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
app.post('/api/vehicles', (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (registrationNumberTaken(r.value.registrationNumber, null)) return res.status(409).json({ error: 'registrationNumber already exists' });
  const record = toRecord(nextId++, r.value);
  vehicles.push(record);
  res.status(201).json(record);
});

app.get('/api/vehicles', (req, res) => {
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

  if (q.type !== undefined && !TYPES.includes(q.type)) {
    return badRequest(res, 'type is not valid');
  }
  if (q.available !== undefined && q.available !== 'true' && q.available !== 'false') {
    return badRequest(res, 'available must be true or false');
  }
  let minRentPerDay = null;
  if (q.minRentPerDay !== undefined) {
    minRentPerDay = parseNumber(q.minRentPerDay);
    if (minRentPerDay === null) return badRequest(res, 'minRentPerDay must be a number');
  }
  let maxRentPerDay = null;
  if (q.maxRentPerDay !== undefined) {
    maxRentPerDay = parseNumber(q.maxRentPerDay);
    if (maxRentPerDay === null) return badRequest(res, 'maxRentPerDay must be a number');
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
  let list = vehicles.filter((b) => {
    if (q.type !== undefined && b.type !== q.type) return false;
    if (q.available !== undefined && b.available !== (q.available === 'true')) return false;
    if (minRentPerDay !== null && b.rentPerDay < minRentPerDay) return false;
    if (maxRentPerDay !== null && b.rentPerDay > maxRentPerDay) return false;
    return true;
  });

  // 2. search on model or brand (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== '') {
    const term = q.search.toLowerCase();
    list = list.filter((b) => b.model.toLowerCase().includes(term) || b.brand.toLowerCase().includes(term));
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

app.get('/api/vehicles/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  res.json(vehicles[i]);
});

app.put('/api/vehicles/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (registrationNumberTaken(r.value.registrationNumber, vehicles[i].id)) return res.status(409).json({ error: 'registrationNumber already exists' });
  vehicles[i] = toRecord(vehicles[i].id, r.value);
  res.json(vehicles[i]);
});

app.patch('/api/vehicles/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  if (r.value.registrationNumber !== undefined && registrationNumberTaken(r.value.registrationNumber, vehicles[i].id)) {
    return res.status(409).json({ error: 'registrationNumber already exists' });
  }
  vehicles[i] = toRecord(vehicles[i].id, { ...vehicles[i], ...r.value });
  res.json(vehicles[i]);
});

app.delete('/api/vehicles/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  vehicles.splice(i, 1);
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
  console.log(`Car Rental API listening on port ${PORT}`);
});
