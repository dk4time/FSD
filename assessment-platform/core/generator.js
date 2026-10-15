'use strict';
// Builds the seed dataset and invalid payloads for one run from a domain config.
// All randomness comes from the rng passed in (mulberry32 seeded per run).

const SEED_COUNT = 45;
const NO_MATCH = 'zzqxj';

// Word pools. No word is a substring of another word in any pool (checked by a unit test),
// so a search for one word never matches a different word by accident.
const TEXT1_WORDS = [
  'amber', 'beacon', 'cedar', 'dune', 'echo', 'fable', 'garnet', 'harvest', 'island', 'jasper',
  'kestrel', 'lagoon', 'meadow', 'nimbus', 'oasis', 'pebble', 'quill', 'raven', 'saffron', 'timber',
  'vortex', 'wander', 'yarrow', 'zenith', 'bramble', 'crystal', 'falcon', 'glacier', 'horizon', 'juniper',
  'lantern', 'marble', 'orchid', 'pioneer', 'quartz', 'ripple', 'sierra', 'tundra', 'velvet', 'willow',
];
// first words that force a case-sensitive sort to differ from a case-insensitive one
const LOW_INITIAL = ['amber', 'beacon', 'cedar', 'dune', 'echo', 'fable', 'bramble', 'crystal', 'falcon'];
const HIGH_INITIAL = ['timber', 'vortex', 'wander', 'yarrow', 'zenith', 'tundra', 'velvet', 'willow'];
// shared by 4-12 records' text1
const SHARED_WORDS = ['classic', 'deluxe', 'royal', 'urban', 'vintage', 'nordic'];
// appears in text1 with different letter case (Prime / PRIME / prime)
const MIXED_WORDS = ['prime', 'grand', 'super', 'metro', 'ultra'];
// appears only in text2, never in text1
const TEXT2_ONLY_WORDS = ['westbrook', 'kingsway', 'riverside', 'oakridge', 'fairview', 'eastgate'];
const TEXT2_WORDS = [
  'north', 'south', 'central', 'global', 'studio', 'works', 'labs', 'house', 'point', 'square',
  'garden', 'valley', 'summit', 'plaza', 'avenue', 'market', 'corner', 'station',
];

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function fieldNames(cfg) {
  return {
    text1: cfg.text1.name,
    text2: cfg.text2.name,
    enum: cfg.enum.name,
    amount: cfg.amount.name,
    count: cfg.count.name,
    flag: cfg.flag.name,
    code: cfg.uniqueCode ? cfg.uniqueCode.name : null,
  };
}

function allFieldNames(cfg) {
  const f = fieldNames(cfg);
  return [f.text1, f.text2, f.enum, f.amount, f.count, f.flag].concat(f.code ? [f.code] : []);
}

function createGenerator(cfg, rng) {
  const F = fieldNames(cfg);
  const usedText1 = new Set();
  const usedCodes = new Set();
  const dec = cfg.amount.genDecimals;
  const scale = 10 ** dec;
  const floorDec = (x) => Math.floor(x * scale + 1e-7) / scale;
  const aMin = cfg.amount.genMin;
  const aMax = cfg.amount.max;

  function randomAmount() {
    const x = Math.exp(Math.log(aMin) + rng.next() * (Math.log(aMax) - Math.log(aMin)));
    return Math.min(aMax, Math.max(aMin, floorDec(x)));
  }

  function randomCount() {
    return rng.int(cfg.count.min, cfg.count.max);
  }

  function fitLength(words, minLen, maxLen, pool) {
    let s = words.join(' ');
    while (s.length > maxLen && words.length > 1) {
      words.splice(words.length - 1, 1);
      s = words.join(' ');
    }
    if (s.length > maxLen) s = s.slice(0, maxLen).trim();
    while (s.length < minLen) {
      s = (s + ' ' + rng.pick(pool)).trim().slice(0, maxLen);
    }
    return s;
  }

  // words: array of {w, fixedCase?}; first word gets the initial-letter style
  function buildText1(core, style) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const first = core.first || rng.pick(TEXT1_WORDS);
      const words = [style === 'upper' ? cap(first) : first.toLowerCase()];
      const middle = [];
      if (core.shared) middle.push(rng.chance(0.5) ? cap(core.shared) : core.shared);
      const extra = core.shared || core.mixed ? (rng.chance(0.4) ? 1 : 0) : rng.int(1, 2);
      for (let i = 0; i < extra; i++) {
        let w = rng.pick(TEXT1_WORDS);
        if (w === first || middle.some((m) => m.toLowerCase() === w)) continue;
        middle.push(rng.chance(0.5) ? cap(w) : w);
      }
      words.push(...rng.shuffle(middle));
      if (rng.chance(0.15)) words.push(String(rng.int(2, 99)));
      if (core.mixed) words.push(core.mixed);
      const text = fitLength(words, cfg.text1.minLen, cfg.text1.maxLen, TEXT1_WORDS);
      const key = text.toLowerCase();
      if (!usedText1.has(key)) {
        usedText1.add(key);
        return text;
      }
    }
    throw new Error('could not build a unique text value');
  }

  function buildText2(withOnly) {
    const words = [cap(rng.pick(TEXT2_WORDS))];
    if (rng.chance(0.5)) {
      const w = rng.pick(TEXT2_WORDS);
      if (w !== words[0].toLowerCase()) words.push(cap(w));
    }
    if (withOnly) words.splice(rng.int(0, words.length), 0, cap(withOnly));
    return fitLength(words, cfg.text2.minLen, cfg.text2.maxLen, TEXT2_WORDS);
  }

  function codePrefix() {
    const letters = cfg.uniqueCode.name.replace(/[^A-Za-z]/g, '').toUpperCase();
    return (letters + 'XXX').slice(0, 3);
  }

  function newCode() {
    const { minLen, maxLen } = cfg.uniqueCode;
    for (let attempt = 0; attempt < 10000; attempt++) {
      let code = `${codePrefix()}-${rng.int(1000, 9999)}`;
      while (code.length < minLen) code += String(rng.int(0, 9));
      code = code.slice(0, maxLen);
      if (!usedCodes.has(code.toLowerCase())) {
        usedCodes.add(code.toLowerCase());
        return code;
      }
    }
    throw new Error('ran out of unique codes');
  }

  function seedAmounts(n) {
    const values = [];
    // a value just below a power of ten and one just above it: their text order is the
    // opposite of their numeric order (e.g. 9400 vs 10250), so a text sort is detectable
    if (aMax >= 10) {
      const k = Math.floor(Math.log10(aMax));
      const p = 10 ** k;
      const below = floorDec(0.9 * p + rng.next() * 0.099 * p);
      const above = aMax === p ? p : floorDec(p + rng.next() * (Math.min(aMax, 2 * p) - p) * 0.99);
      if (below >= aMin) values.push(below);
      values.push(above);
    }
    const triple = randomAmount();
    values.push(triple, triple, triple);
    while (values.length < n) values.push(randomAmount());
    return rng.shuffle(values);
  }

  function seedCounts(n) {
    const values = [cfg.count.min, cfg.count.max];
    while (values.length < n) values.push(randomCount());
    return rng.shuffle(values);
  }

  function balanced(n, values, minEach) {
    const out = [];
    for (const v of values) for (let i = 0; i < minEach; i++) out.push(v);
    while (out.length < n) out.push(rng.pick(values));
    return rng.shuffle(out);
  }

  function makeSeeds() {
    const n = SEED_COUNT;
    const idx = [...Array(n).keys()];
    const shared = rng.pick(SHARED_WORDS);
    const mixed = rng.pick(MIXED_WORDS);
    const text2Only = rng.pick(TEXT2_ONLY_WORDS);

    const sharedSet = new Set(rng.sample(idx, rng.int(5, 10)));
    const mixedIdx = rng.sample(idx, rng.int(3, 6));
    const mixedForms = new Map();
    mixedIdx.forEach((i, k) => {
      const form = k === 0 ? cap(mixed) : k === 1 ? mixed.toUpperCase() : k === 2 ? mixed : rng.pick([cap(mixed), mixed.toUpperCase(), mixed]);
      mixedForms.set(i, form);
    });
    const onlySet = new Set(rng.sample(idx, rng.int(3, 6)));

    const order = rng.shuffle(idx);
    const style = new Array(n);
    order.forEach((i, k) => {
      style[i] = k < 20 ? 'upper' : k < 40 ? 'lower' : rng.pick(['upper', 'lower']);
    });
    const lowRec = order[20];
    const highRec = order[0];
    const firstWord = new Map([
      [lowRec, rng.pick(LOW_INITIAL)],
      [highRec, rng.pick(HIGH_INITIAL)],
    ]);

    const enums = balanced(n, cfg.enum.values, Math.min(4, Math.floor(n / cfg.enum.values.length)));
    const flags = rng.shuffle([...Array(12).fill(true), ...Array(12).fill(false), ...Array.from({ length: n - 24 }, () => rng.chance(0.5))]);
    const amounts = seedAmounts(n);
    const counts = seedCounts(n);

    const seeds = idx.map((i) => {
      const rec = {};
      rec[F.text1] = buildText1(
        { first: firstWord.get(i), shared: sharedSet.has(i) ? shared : null, mixed: mixedForms.get(i) || null },
        style[i],
      );
      rec[F.text2] = buildText2(onlySet.has(i) ? text2Only : null);
      rec[F.enum] = enums[i];
      rec[F.amount] = amounts[i];
      rec[F.count] = counts[i];
      rec[F.flag] = flags[i];
      if (F.code) rec[F.code] = newCode();
      return rec;
    });
    return { seeds, special: { shared, mixed, text2Only, noMatch: NO_MATCH } };
  }

  // A fresh valid record (scratch records, negative tests). Unique text1 and code.
  function makeRecord() {
    const rec = {};
    rec[F.text1] = buildText1({}, rng.pick(['upper', 'lower']));
    rec[F.text2] = buildText2(null);
    rec[F.enum] = rng.pick(cfg.enum.values);
    rec[F.amount] = randomAmount();
    rec[F.count] = randomCount();
    rec[F.flag] = rng.chance(0.5);
    if (F.code) rec[F.code] = newCode();
    return rec;
  }

  const { seeds, special } = makeSeeds();

  const invalidEnum = (() => {
    let v = 'InvalidValue';
    while (cfg.enum.values.includes(v)) v += 'X';
    return v;
  })();

  const invalid = {
    missing(field) {
      const rec = makeRecord();
      delete rec[field];
      return rec;
    },
    with(field, value) {
      const rec = makeRecord();
      rec[field] = value;
      return rec;
    },
    shortText1() {
      const len = Math.max(0, cfg.text1.minLen - 1);
      return 'Ab'.repeat(len).slice(0, len);
    },
    invalidEnum,
    malformedJson: `{"${F.text1}": "Broken record", "${F.amount}": 12,`,
  };

  return { fields: F, seeds, special, makeRecord, invalid, newCode };
}

module.exports = {
  createGenerator,
  fieldNames,
  allFieldNames,
  SEED_COUNT,
  NO_MATCH,
  POOLS: { TEXT1_WORDS, LOW_INITIAL, HIGH_INITIAL, SHARED_WORDS, MIXED_WORDS, TEXT2_ONLY_WORDS, TEXT2_WORDS },
};
