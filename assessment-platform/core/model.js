'use strict';
// The evaluator's own in-memory model of every record it created, with the id the server
// returned. Every expected value in a test is computed from this model, never from what the
// server returned. query() applies the list contract: filter -> search -> sort -> paginate.

const { fieldNames } = require('./generator');

const EPS = 1e-9;
const numEq = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= EPS;
const codeUnitCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const lowerCmp = (a, b) => codeUnitCmp(String(a).toLowerCase(), String(b).toLowerCase());
const localeCmp = (a, b) => String(a).localeCompare(String(b), 'en');

class Model {
  constructor(cfg) {
    this.cfg = cfg;
    this.F = fieldNames(cfg);
    this.records = [];
  }

  add(id, fields) {
    this.records.push({ id, ...structuredClone(fields) });
  }

  get(id) {
    return this.records.find((r) => String(r.id) === String(id));
  }

  update(id, fields) {
    const r = this.get(id);
    if (r) Object.assign(r, structuredClone(fields));
  }

  remove(id) {
    this.records = this.records.filter((r) => String(r.id) !== String(id));
  }

  ids() {
    return this.records.map((r) => r.id);
  }

  get size() {
    return this.records.length;
  }

  // params: same keys and string values as the query string the test sends
  query(params = {}) {
    const F = this.F;
    const [minParam, maxParam] = this.cfg.amount.rangeFilter;
    const has = (k) => params[k] !== undefined && params[k] !== null;
    let items = this.records.slice();

    if (has(F.enum)) items = items.filter((r) => r[F.enum] === String(params[F.enum]));
    if (has(F.flag)) {
      const want = String(params[F.flag]) === 'true';
      items = items.filter((r) => r[F.flag] === want);
    }
    if (has(minParam)) items = items.filter((r) => r[F.amount] >= Number(params[minParam]));
    if (has(maxParam)) items = items.filter((r) => r[F.amount] <= Number(params[maxParam]));

    const term = has('search') ? String(params.search).toLowerCase() : '';
    if (term !== '') {
      items = items.filter(
        (r) => String(r[F.text1]).toLowerCase().includes(term) || String(r[F.text2]).toLowerCase().includes(term),
      );
    }

    if (has('sort')) {
      const field = String(params.sort);
      const desc = String(params.order || 'asc') === 'desc';
      const isText = field === F.text1;
      items.sort((a, b) => {
        const c = isText ? lowerCmp(a[field], b[field]) : a[field] - b[field];
        return desc ? -c : c;
      });
    }

    const total = items.length;
    const page = has('page') ? Number(params.page) : 1;
    const limit = has('limit') ? Number(params.limit) : 10;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = items.slice((page - 1) * limit, page * limit);
    return { data, total, totalPages, page, limit };
  }
}

// true if values are non-decreasing (or non-increasing when desc) as numbers
function isSortedNumbers(values, desc = false) {
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (desc ? d > EPS : d < -EPS) return false;
    if (typeof values[i] !== 'number' || Number.isNaN(values[i])) return false;
  }
  return true;
}

// accepted if non-decreasing under lower-cased code-unit order OR localeCompare('en')
function isSortedText(values, desc = false) {
  const ok = (cmp) => values.every((v, i) => i === 0 || (desc ? cmp(values[i - 1], v) >= 0 : cmp(values[i - 1], v) <= 0));
  return values.every((v) => typeof v === 'string') && (ok(lowerCmp) || ok(localeCmp));
}

module.exports = { Model, numEq, isSortedNumbers, isSortedText, lowerCmp, EPS };
