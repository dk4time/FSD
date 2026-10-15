'use strict';
// npm run build-kits  ->  dist/assessment-kit.zip (sets listed in kits/assessment/sets.json)
// Needs collector/.env (COLLECTOR_KEY) and the env var PUBLIC_COLLECTOR_URL (the LAN URL the
// collector prints at start-up, e.g. http://192.168.1.20:4000).
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { readEnv } = require('./read-env');

const ROOT = path.join(__dirname, '..');
const KIT_SRC = path.join(ROOT, 'kits', 'assessment');
const KIT_FOLDER = 'assessment-kit';

// Text that must never appear in anything a student receives (checked case-insensitively).
const FORBIDDEN = ['mongodb', 'MONGODB_URI', 'ADMIN_PASSWORD', 'trainer-only', 'reference', 'renderTrainer', 'P1.json', 'P2.json', 'atlas', 'practice'];

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Lays out a kit folder: core/, cli.js, sets.json (full configs), package.json, config.json, README.md, .gitignore
function assembleKit(dir, { sets, collectorUrl, collectorKey }) {
  fs.mkdirSync(dir, { recursive: true });
  copyDir(path.join(ROOT, 'core'), path.join(dir, 'core'));
  for (const f of ['cli.js', 'package.json', 'README.md', '.gitignore']) fs.copyFileSync(path.join(KIT_SRC, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'sets.json'), JSON.stringify(sets, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ collectorUrl, collectorKey }, null, 2) + '\n');
  return dir;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

// returns a list of problems (empty when the kit is clean)
function scanKit(dir) {
  const problems = [];
  for (const rel of listFiles(dir)) {
    if (/(^|\/)domains\/P[^/]*\.json$/i.test(rel)) problems.push(`${rel}: practice domain file`);
    const text = fs.readFileSync(path.join(dir, rel), 'utf8').toLowerCase();
    for (const word of FORBIDDEN) {
      if (text.includes(word.toLowerCase()) || rel.toLowerCase().includes(word.toLowerCase())) problems.push(`${rel}: contains "${word}"`);
    }
  }
  return problems;
}

// ---- minimal zip writer (deflate), no dependencies ------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function fail(message) {
  console.error(`build-kits: ${message}`);
  process.exit(1);
}

function main() {
  const env = readEnv(path.join(ROOT, 'collector', '.env'));
  if (!env || !env.COLLECTOR_KEY) fail('collector/.env with COLLECTOR_KEY is required (copy collector/.env.example).');
  const collectorUrl = process.env.PUBLIC_COLLECTOR_URL;
  if (!collectorUrl || !/^https?:\/\/[^/]+/.test(collectorUrl)) {
    fail('set PUBLIC_COLLECTOR_URL to the URL the collector prints, e.g.\n  PUBLIC_COLLECTOR_URL=http://192.168.1.20:4000 npm run build-kits');
  }

  const ids = JSON.parse(fs.readFileSync(path.join(KIT_SRC, 'sets.json'), 'utf8'));
  const sets = [];
  for (const id of ids) {
    if (!/^A([1-9]|10)$/.test(id)) fail(`kits/assessment/sets.json may only list A1-A10, found "${id}"`);
    const file = path.join(ROOT, 'domains', `${id}.json`);
    if (!fs.existsSync(file)) fail(`domains/${id}.json is missing`);
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cfg.mode !== 'assessment' || cfg.setId !== id) fail(`domains/${id}.json is not an assessment set`);
    sets.push(cfg);
  }
  const missing = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'].filter((id) => !ids.includes(id));
  if (missing.length) console.warn(`WARNING: the kit does not contain ${missing.join(', ')}. Students with those sets cannot run it.`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  const kitDir = path.join(staging, KIT_FOLDER);
  try {
    assembleKit(kitDir, { sets, collectorUrl: collectorUrl.replace(/\/+$/, ''), collectorKey: env.COLLECTOR_KEY });
    const problems = scanKit(kitDir);
    if (problems.length) fail(`secrets scan failed:\n  ${problems.join('\n  ')}`);
    const files = listFiles(kitDir);
    const zip = makeZip(files.map((rel) => ({ name: `${KIT_FOLDER}/${rel}`, data: fs.readFileSync(path.join(kitDir, rel)) })));
    const dist = path.join(ROOT, 'dist');
    fs.rmSync(dist, { recursive: true, force: true });
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'assessment-kit.zip'), zip);
    console.log(`Secrets scan passed. Sets in kit: ${ids.join(', ') || '(none)'}. Collector: ${collectorUrl}`);
    console.log('dist/assessment-kit.zip contains:');
    for (const f of files) console.log(`  ${KIT_FOLDER}/${f}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { assembleKit, scanKit, listFiles, makeZip, FORBIDDEN };
