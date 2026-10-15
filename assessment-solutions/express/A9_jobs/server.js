// Job Postings API (Assessment Set A9) - Express, in-memory, no database.
const express = require('express');

const app = express();
app.use(express.json());

// ---------- data ----------
const jobs = []; // records in creation order
let nextId = 1;

const JOB_TYPES = ['FullTime', 'PartTime', 'Internship', 'Contract', 'Freelance'];
const SORT_FIELDS = ['title', 'monthlySalary', 'openings'];

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
  company: (b) => checkText(b, 'company', 2, 40),
  jobType: (b) => {
    if (typeof b.jobType !== 'string' || !JOB_TYPES.includes(b.jobType)) {
      return { error: `jobType must be one of ${JOB_TYPES.join(', ')}` };
    }
    return { value: b.jobType };
  },
  monthlySalary: (b) => {
    const v = b.monthlySalary;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: 'monthlySalary must be a number' };
    if (v <= 0) return { error: 'monthlySalary must be greater than 0' };
    if (v > 500000) return { error: 'monthlySalary must be at most 500000' };
    return { value: v };
  },
  openings: (b) => {
    const v = b.openings;
    if (typeof v !== 'number' || !Number.isInteger(v)) return { error: 'openings must be a whole number' };
    if (v < 1 || v > 500) return { error: 'openings must be from 1 to 500' };
    return { value: v };
  },
  isRemote: (b) => {
    if (typeof b.isRemote !== 'boolean') return { error: 'isRemote must be true or false' };
    return { value: b.isRemote };
  },
  jobCode: (b) => checkText(b, 'jobCode', 4, 20),
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

// jobCode is unique ignoring letter case; the record with id exceptId may keep its own value
function jobCodeTaken(jobCode, exceptId) {
  const wanted = jobCode.toLowerCase();
  return jobs.some((b) => b.id !== exceptId && b.jobCode.toLowerCase() === wanted);
}

function findIndex(id) {
  return jobs.findIndex((b) => String(b.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    title: data.title,
    company: data.company,
    jobType: data.jobType,
    monthlySalary: data.monthlySalary,
    openings: data.openings,
    isRemote: data.isRemote,
    jobCode: data.jobCode,
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
app.post('/api/jobs', (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (jobCodeTaken(r.value.jobCode, null)) return res.status(409).json({ error: 'jobCode already exists' });
  const record = toRecord(nextId++, r.value);
  jobs.push(record);
  res.status(201).json(record);
});

app.get('/api/jobs', (req, res) => {
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

  if (q.jobType !== undefined && !JOB_TYPES.includes(q.jobType)) {
    return badRequest(res, 'jobType is not valid');
  }
  if (q.isRemote !== undefined && q.isRemote !== 'true' && q.isRemote !== 'false') {
    return badRequest(res, 'isRemote must be true or false');
  }
  let minMonthlySalary = null;
  if (q.minMonthlySalary !== undefined) {
    minMonthlySalary = parseNumber(q.minMonthlySalary);
    if (minMonthlySalary === null) return badRequest(res, 'minMonthlySalary must be a number');
  }
  let maxMonthlySalary = null;
  if (q.maxMonthlySalary !== undefined) {
    maxMonthlySalary = parseNumber(q.maxMonthlySalary);
    if (maxMonthlySalary === null) return badRequest(res, 'maxMonthlySalary must be a number');
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
  let list = jobs.filter((b) => {
    if (q.jobType !== undefined && b.jobType !== q.jobType) return false;
    if (q.isRemote !== undefined && b.isRemote !== (q.isRemote === 'true')) return false;
    if (minMonthlySalary !== null && b.monthlySalary < minMonthlySalary) return false;
    if (maxMonthlySalary !== null && b.monthlySalary > maxMonthlySalary) return false;
    return true;
  });

  // 2. search on title or company (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== '') {
    const term = q.search.toLowerCase();
    list = list.filter((b) => b.title.toLowerCase().includes(term) || b.company.toLowerCase().includes(term));
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

app.get('/api/jobs/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  res.json(jobs[i]);
});

app.put('/api/jobs/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (jobCodeTaken(r.value.jobCode, jobs[i].id)) return res.status(409).json({ error: 'jobCode already exists' });
  jobs[i] = toRecord(jobs[i].id, r.value);
  res.json(jobs[i]);
});

app.patch('/api/jobs/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  if (r.value.jobCode !== undefined && jobCodeTaken(r.value.jobCode, jobs[i].id)) {
    return res.status(409).json({ error: 'jobCode already exists' });
  }
  jobs[i] = toRecord(jobs[i].id, { ...jobs[i], ...r.value });
  res.json(jobs[i]);
});

app.delete('/api/jobs/:id', (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  jobs.splice(i, 1);
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
  console.log(`Job Postings API listening on port ${PORT}`);
});
