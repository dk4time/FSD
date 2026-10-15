'use strict';
// Shared helpers for the test groups. A test returns { pass, request, expected, actual } or
// throws Blocked when something it depends on (its own scratch POST) did not work.

const { numEq, isSortedNumbers, isSortedText } = require('../model');
const { allFieldNames } = require('../generator');

class Blocked extends Error {}

const UNKNOWN_NUMERIC_ID = '987654321';
const UNKNOWN_STRING_ID = 'no-such-id';

function snippet(text, n = 200) {
  const s = text === undefined || text === null ? '' : String(text);
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function actualOf(res) {
  if (!res) return 'no request made';
  if (res.status === 0) return `no response (${res.error})`;
  return `${res.status} ${snippet(res.text) || '(empty body)'}`;
}

function pass() {
  return { pass: true };
}

function fail(res, expected, note) {
  return {
    pass: false,
    request: res ? res.request : '',
    expected,
    actual: note ? `${note} | ${actualOf(res)}` : actualOf(res),
  };
}

function check(cond, res, expected, note) {
  return cond ? pass() : fail(res, expected, note);
}

const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function isErrorBody(res) {
  const j = res && res.json;
  return !!j && typeof j === 'object' && !Array.isArray(j) && (nonEmptyString(j.error) || nonEmptyString(j.message));
}

const isJsonType = (res) => !!res && /application\/json/i.test(res.contentType || '');

const hasId = (v) => v !== undefined && v !== null && String(v) !== '' && typeof v !== 'object';
const sameId = (a, b) => hasId(a) && hasId(b) && String(a) === String(b);

function valueEq(expected, actual) {
  if (typeof expected === 'number') return numEq(expected, actual);
  return expected === actual;
}

// compares every config field; returns list of differences (empty when equal)
function fieldDiffs(cfg, expected, actual) {
  if (!actual || typeof actual !== 'object') return ['body is not a JSON object'];
  const diffs = [];
  for (const f of allFieldNames(cfg)) {
    if (expected[f] === undefined) continue;
    if (!valueEq(expected[f], actual[f])) diffs.push(`${f}: expected ${JSON.stringify(expected[f])}, got ${JSON.stringify(actual[f])}`);
  }
  return diffs;
}

function fieldsMatch(cfg, expected, actual) {
  return fieldDiffs(cfg, expected, actual).length === 0;
}

// a list response with the documented envelope, or null
function listBody(res) {
  const j = res && res.json;
  if (res.status !== 200 || !j || typeof j !== 'object' || !Array.isArray(j.data)) return null;
  return j;
}

const idsOf = (items) => items.map((r) => (r && typeof r === 'object' ? String(r.id) : String(r)));
const sameIdList = (a, b) => a.length === b.length && a.every((v, i) => String(v) === String(b[i]));

function toggleCase(s) {
  const t = s.toLowerCase();
  return t !== s ? t : s.toUpperCase();
}

// a second, different case variant: only the first letter flipped (so it never equals toggleCase(s)
// for codes with 2+ letters, e.g. EMP-1042 -> eMP-1042 while toggleCase gives emp-1042)
function flipFirstLetter(s) {
  const i = s.search(/[A-Za-z]/);
  if (i < 0) return s;
  const c = s[i];
  const f = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
  return s.slice(0, i) + f + s.slice(i + 1);
}

function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.append(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

module.exports = {
  Blocked,
  UNKNOWN_NUMERIC_ID,
  UNKNOWN_STRING_ID,
  snippet,
  actualOf,
  pass,
  fail,
  check,
  isErrorBody,
  isJsonType,
  hasId,
  sameId,
  fieldDiffs,
  fieldsMatch,
  listBody,
  idsOf,
  sameIdList,
  toggleCase,
  flipFirstLetter,
  qs,
  isSortedNumbers,
  isSortedText,
};
