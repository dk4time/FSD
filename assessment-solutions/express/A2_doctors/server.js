// Doctor Directory API (Assessment Set A2) - Express, in-memory, no database.
const express = require("express");

const app = express();
app.use(express.json());

// ---------- data ----------
const doctors = []; // records in creation order
let nextId = 1;

const SPECIALIZATIONS = [
  "Cardiology",
  "Dermatology",
  "Neurology",
  "Pediatrics",
  "Orthopedics",
];
const SORT_FIELDS = ["name", "consultationFee", "experienceYears"];

// ---------- validation helpers ----------
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Each checker returns { value } when valid or { error } when not.
function checkText(body, field, min, max) {
  const v = body[field];
  if (typeof v !== "string") return { error: `${field} must be a string` };
  const t = v.trim();
  if (t.length === 0) return { error: `${field} must not be blank` };
  if (t.length < min || t.length > max)
    return { error: `${field} must be ${min} to ${max} characters` };
  return { value: t };
}

const validators = {
  name: (b) => checkText(b, "name", 3, 60),
  clinic: (b) => checkText(b, "clinic", 2, 40),
  specialization: (b) => {
    if (
      typeof b.specialization !== "string" ||
      !SPECIALIZATIONS.includes(b.specialization)
    ) {
      return {
        error: `specialization must be one of ${SPECIALIZATIONS.join(", ")}`,
      };
    }
    return { value: b.specialization };
  },
  consultationFee: (b) => {
    const v = b.consultationFee;
    if (typeof v !== "number" || !Number.isFinite(v))
      return { error: "consultationFee must be a number" };
    if (v <= 0) return { error: "consultationFee must be greater than 0" };
    if (v > 50000) return { error: "consultationFee must be at most 50000" };
    return { value: v };
  },
  experienceYears: (b) => {
    const v = b.experienceYears;
    if (typeof v !== "number" || !Number.isInteger(v))
      return { error: "experienceYears must be a whole number" };
    if (v < 0 || v > 60)
      return { error: "experienceYears must be from 0 to 60" };
    return { value: v };
  },
  acceptingPatients: (b) => {
    if (typeof b.acceptingPatients !== "boolean")
      return { error: "acceptingPatients must be true or false" };
    return { value: b.acceptingPatients };
  },
  licenseNumber: (b) => checkText(b, "licenseNumber", 4, 20),
};
const FIELDS = Object.keys(validators);

// partial = true for PATCH: only validate the fields that were sent.
function validateBody(body, partial) {
  if (!isPlainObject(body))
    return { error: "Request body must be a JSON object" };
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
  if (partial && sent === 0)
    return { error: "Send at least one field to update" };
  return { value: clean };
}

// licenseNumber is unique ignoring letter case; the record with id exceptId may keep its own value
function licenseNumberTaken(licenseNumber, exceptId) {
  const wanted = licenseNumber.toLowerCase();
  return doctors.some(
    (b) => b.id !== exceptId && b.licenseNumber.toLowerCase() === wanted,
  );
}

function findIndex(id) {
  return doctors.findIndex((b) => String(b.id) === id);
}

function toRecord(id, data) {
  return {
    id,
    name: data.name,
    clinic: data.clinic,
    specialization: data.specialization,
    consultationFee: data.consultationFee,
    experienceYears: data.experienceYears,
    acceptingPatients: data.acceptingPatients,
    licenseNumber: data.licenseNumber,
  };
}

// ---------- query helpers ----------
// Returns a number or null when the text is not a positive whole number.
function parsePositiveInt(text) {
  if (typeof text !== "string" || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 ? n : null;
}

function parseNumber(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function notFound(res) {
  return res.status(404).json({ error: "Record not found" });
}

// ---------- routes ----------
app.post("/api/doctors", (req, res) => {
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (licenseNumberTaken(r.value.licenseNumber, null))
    return res.status(409).json({ error: "licenseNumber already exists" });
  const record = toRecord(nextId++, r.value);
  doctors.push(record);
  res.status(201).json(record);
});

app.get("/api/doctors", (req, res) => {
  const q = req.query;

  let page = 1;
  if (q.page !== undefined) {
    page = parsePositiveInt(q.page);
    if (page === null)
      return badRequest(res, "page must be a positive integer");
  }
  let limit = 10;
  if (q.limit !== undefined) {
    limit = parsePositiveInt(q.limit);
    if (limit === null || limit > 50)
      return badRequest(res, "limit must be a positive integer up to 50");
  }

  if (
    q.specialization !== undefined &&
    !SPECIALIZATIONS.includes(q.specialization)
  ) {
    return badRequest(res, "specialization is not valid");
  }
  if (
    q.acceptingPatients !== undefined &&
    q.acceptingPatients !== "true" &&
    q.acceptingPatients !== "false"
  ) {
    return badRequest(res, "acceptingPatients must be true or false");
  }
  let minConsultationFee = null;
  if (q.minConsultationFee !== undefined) {
    minConsultationFee = parseNumber(q.minConsultationFee);
    if (minConsultationFee === null)
      return badRequest(res, "minConsultationFee must be a number");
  }
  let maxConsultationFee = null;
  if (q.maxConsultationFee !== undefined) {
    maxConsultationFee = parseNumber(q.maxConsultationFee);
    if (maxConsultationFee === null)
      return badRequest(res, "maxConsultationFee must be a number");
  }
  if (q.sort !== undefined && !SORT_FIELDS.includes(q.sort)) {
    return badRequest(res, `sort must be one of ${SORT_FIELDS.join(", ")}`);
  }
  if (q.order !== undefined && q.order !== "asc" && q.order !== "desc") {
    return badRequest(res, "order must be asc or desc");
  }
  if (q.search !== undefined && typeof q.search !== "string") {
    return badRequest(res, "search must be text");
  }

  // 1. filters
  let list = doctors.filter((b) => {
    if (q.specialization !== undefined && b.specialization !== q.specialization)
      return false;
    if (
      q.acceptingPatients !== undefined &&
      b.acceptingPatients !== (q.acceptingPatients === "true")
    )
      return false;
    if (minConsultationFee !== null && b.consultationFee < minConsultationFee)
      return false;
    if (maxConsultationFee !== null && b.consultationFee > maxConsultationFee)
      return false;
    return true;
  });

  // 2. search on name or clinic (empty value = no search)
  if (q.search !== undefined && q.search.trim() !== "") {
    const term = q.search.toLowerCase();
    list = list.filter(
      (b) =>
        b.name.toLowerCase().includes(term) ||
        b.clinic.toLowerCase().includes(term),
    );
  }

  // 3. sort (Array.prototype.sort is stable, so ties keep creation order)
  if (q.sort !== undefined) {
    const field = q.sort;
    const dir = q.order === "desc" ? -1 : 1;
    list = [...list].sort((a, b) => {
      let x = a[field];
      let y = b[field];
      if (typeof x === "string") {
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

app.get("/api/doctors/:id", (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  res.json(doctors[i]);
});

app.put("/api/doctors/:id", (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, false);
  if (r.error) return badRequest(res, r.error);
  if (licenseNumberTaken(r.value.licenseNumber, doctors[i].id))
    return res.status(409).json({ error: "licenseNumber already exists" });
  doctors[i] = toRecord(doctors[i].id, r.value);
  res.json(doctors[i]);
});

app.patch("/api/doctors/:id", (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  const r = validateBody(req.body, true);
  if (r.error) return badRequest(res, r.error);
  if (
    r.value.licenseNumber !== undefined &&
    licenseNumberTaken(r.value.licenseNumber, doctors[i].id)
  ) {
    return res.status(409).json({ error: "licenseNumber already exists" });
  }
  doctors[i] = toRecord(doctors[i].id, { ...doctors[i], ...r.value });
  res.json(doctors[i]);
});

app.delete("/api/doctors/:id", (req, res) => {
  const i = findIndex(req.params.id);
  if (i === -1) return notFound(res);
  doctors.splice(i, 1);
  res.status(204).end();
});

// Unknown route -> JSON 404
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Malformed JSON (and any other error) -> JSON, never an HTML page
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body" });
  }
  const status =
    err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  res
    .status(status)
    .json({
      error:
        status === 500 ? "Internal server error" : err.message || "Bad request",
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Doctor Directory API listening on port ${PORT}`);
});
