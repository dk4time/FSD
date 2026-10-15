'use strict';
const fs = require('fs');
const path = require('path');

const DOMAINS_DIR = path.join(__dirname, '..', 'domains');

function listSets() {
  return fs.readdirSync(DOMAINS_DIR).filter((f) => /^[A-Z]\d+\.json$/.test(f)).map((f) => f.replace('.json', '')).sort();
}

function loadSet(setId) {
  const file = path.join(DOMAINS_DIR, `${String(setId).toUpperCase()}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No domain config for set ${setId}. Available: ${listSets().join(', ') || '(none)'}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// tiny argv parser: --key value, --flag
function parseArgs(argv, flags = []) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      if (inline !== undefined) out[k] = inline;
      else if (flags.includes(k)) out[k] = true;
      else out[k] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

module.exports = { DOMAINS_DIR, listSets, loadSet, parseArgs };
