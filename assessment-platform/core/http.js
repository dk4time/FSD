'use strict';

const DEFAULT_TIMEOUT_MS = 5000;

function describeError(err) {
  const code = err && err.cause && err.cause.code;
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'connection closed by the server';
  if (code) return code;
  return (err && err.message) || String(err);
}

// Sends one HTTP request. Never throws: network errors and timeouts come back as status 0.
// opts.body is sent as JSON; opts.raw is sent as-is with a JSON content type (malformed JSON tests).
async function request(method, url, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const headers = { accept: 'application/json', ...(opts.headers || {}) };
  let payload;
  if (opts.raw !== undefined) {
    payload = opts.raw;
    headers['content-type'] = 'application/json';
  } else if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { method, headers, body: payload, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers),
      contentType: res.headers.get('content-type') || '',
      text,
      json,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      status: 0,
      error: ctrl.signal.aborted ? `no response within ${timeoutMs / 1000} s` : describeError(err),
      headers: {},
      contentType: '',
      text: '',
      json: undefined,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { request, DEFAULT_TIMEOUT_MS };
