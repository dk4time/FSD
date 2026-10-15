// Employee Directory API (Assessment Set A1) - Express, in-memory, no database.
const express = require('express');

const app = express();
app.use(express.json());

// ---------- data ----------
const employees = []; // records in creation order
let nextId = 1;

const DEPARTMENTS = ['Engineering', 'HR', 'Finance', 'Sales', 'Support'];
const SORT_FIELDS = ['name', 'salary', 'experienceYears'];

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
  designation: (b) => checkText(b, 'designation', 2, 40),
  department: (b) => {
    if (typeof b.department !== 'string' || !DEPARTMENTS.includes(b.department)) {
      return { error: `department must be one of ${DEPARTMENTS.join(', ')}` };
    }
    return { value: b.department };
  },
  salary: (b) => {
    const v = b.salary;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'salary must be a number' };
    if (v <= 0) return { error: 'salary must be greater than 0' };
    if (v > 10000000) return { error: 'salary must be at most 10000000' };
    return { value: v };
  },
  experienceYears: (b) => {
    const v = b.experienceYears;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'experienceYears must be a whole number' };
    if (v < 0 || v > 45) return { error: 'experienceYears must be from 0 to 45' };
    return { value: v };
  },
  isActive: (b) => {
    if (typeof b.isActive !== 'boolean') return { error: 'isActive must be true or false' };
    return { value: b.isActive };
  },
  employeeCode: (b) => checkText(b, 'employeeCode', 4, 20),
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

// employeeCode is unique ignoring letter case; the record with id exceptId may keep its own value
function employeeCodeTaken(employeeCode, exceptId) {
  const wanted = employeeCode.toLowerCase();
  return employees.some((b) => b.id !== exceptId && b.employeeCode.toLowerCase() === wanted);
}

function findIndex(id) {
  return employees.findIndex((b) => String(b.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    name: data.name,
    designation: data.designation,
    department: data.department,
    salary: data.salary,
    experienceYears: data.experienceYears,
    isActive: data.isActive,
    employeeCode: data.employeeCode,
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
app.post('/api/employees', (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (employeeCodeTaken(r.value.employeeCode, null)) return res.status(409).json({ error: 'employeeCode already exists' });
  const record = toRecord(nextId++, r.value);
  employees.push(record);
  res.status(201).json(record);
});

app.get('/api/employees', (req, res) => {
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

  if (q.department !== undefined && !DEPARTMENTS.includes(q.department)) {
    return badRequest(res, 'department is not valid');
  }
  if (q.isActive !== undefined && q.isActive !== 'true' && q.isActive !== 'false') {
    return badRequest(res, 'isActive must be true or false');
  }
  let minSalary = null;
  if (q.minSalary !== undefined) {
    minSalary = parseNumber(q.minSalary);
    if (minSalary === null) return badRequest(res, 'minSalary must be a number');
  }
  let maxSalary = null;
  if (q.maxSalary !== undefined) {
    maxSalary = parseNumber(q.maxSalary);
    if (maxSalary === null) return badRequest(res, 'maxSalary must be a number');
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
  let list = employees.filter((b) => {
    if (q.department !== undefined && b.department !== q.department) return false;
    if (q.isActive !== undefined && b.isActive !== (q.isActive === 'true')) return false;
    if (minSalary !== null && b.salary < minSalary) return false;
    if (maxSalary !== null && b.salary > maxSalary) return false;
    return true;
  });

  // 2. search on name or designation (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== '') {
    const term = q.search.toLowerCase();
    list = list.filter((b) => b.name.toLowerCase().includes(term) || b.designation.toLowerCase().includes(term));
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

app.get('/api/employees/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  res.json(employees[i]);
});

app.put('/api/employees/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (employeeCodeTaken(r.value.employeeCode, employees[i].id)) return res.status(409).json({ error: 'employeeCode already exists' });
  employees[i] = toRecord(employees[i].id, r.value);
  res.json(employees[i]);
});

app.patch('/api/employees/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  if (r.value.employeeCode !== undefined && employeeCodeTaken(r.value.employeeCode, employees[i].id)) {
    return res.status(409).json({ error: 'employeeCode already exists' });
  }
  employees[i] = toRecord(employees[i].id, { ...employees[i], ...r.value });
  res.json(employees[i]);
});

app.delete('/api/employees/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  employees.splice(i, 1);
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
  console.log(`Employee Directory API listening on port ${PORT}`);
});
