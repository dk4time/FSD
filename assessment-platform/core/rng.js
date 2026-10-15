'use strict';
const crypto = require('crypto');

// mulberry32: small, fast, seedable 32-bit PRNG. Same seed -> same sequence on every machine.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    next,
    // integer in [lo, hi] inclusive
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    chance(p) {
      return next() < p;
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    sample(arr, n) {
      return rng.shuffle(arr).slice(0, n);
    },
  };
  return rng;
}

function randomSeed() {
  return crypto.randomBytes(4).readUInt32BE(0);
}

module.exports = { mulberry32, makeRng, randomSeed };
