'use strict';
// Per-student PINs. A PIN is derived from the registration number and PIN_SECRET (collector/.env only,
// never in a kit), so nothing has to be stored and slips can be reprinted at any time. Changing
// PIN_SECRET changes every PIN.

const crypto = require('crypto');
const { normalizeReg } = require('./assign');

const PIN_REGEX = /^\d{6}$/;

function pinFor(secret, reg) {
  const h = crypto.createHmac('sha256', String(secret)).update(`pin|${normalizeReg(reg)}`).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

function pinMatches(secret, reg, pin) {
  if (typeof pin !== 'string' || !PIN_REGEX.test(pin)) return false;
  return crypto.timingSafeEqual(Buffer.from(pinFor(secret, reg)), Buffer.from(pin));
}

// Wrong-PIN limiter: 5 failures per (client, registration number) and 20 per client, per 15 minutes.
// Keyed by client too, so one student cannot lock a classmate out from their own laptop.
function createPinLimiter({ perReg = 5, perClient = 20, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map(); // key -> [timestamps]
  const recent = (key, now) => (failures.get(key) || []).filter((t) => now - t < windowMs);
  return {
    isLocked(client, reg, now = Date.now()) {
      return recent(`${client}|${reg}`, now).length >= perReg || recent(client, now).length >= perClient;
    },
    fail(client, reg, now = Date.now()) {
      for (const key of [`${client}|${reg}`, client]) failures.set(key, [...recent(key, now), now]);
    },
    succeed(client, reg) {
      failures.delete(`${client}|${reg}`);
    },
  };
}

module.exports = { PIN_REGEX, pinFor, pinMatches, createPinLimiter };
