#!/usr/bin/env node
'use strict';
// Assessment kit. Runs the checks for the set the student entered (the set on their question paper)
// and sends the result to the trainer's collector. It prints each check as PASS or FAIL, but never
// prints marks or stores per-check results on this computer.
//   npm run evaluate -- [--url http://localhost:8080] [--wait 60]
//   npm run whoami [-- --change]
//   npm run submit-pending

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const KIT_DIR = __dirname;
const CORE = fs.existsSync(path.join(KIT_DIR, 'core')) ? path.join(KIT_DIR, 'core') : path.join(KIT_DIR, '..', '..', 'core');
const { runSet, GROUPS } = require(path.join(CORE, 'engine'));
const { randomSeed } = require(path.join(CORE, 'rng'));
const { isValidReg, normalizeReg, isValidSet, normalizeSet } = require(path.join(CORE, 'assign'));
const { MESSAGES, renderStudent, renderChecks } = require(path.join(CORE, 'report'));
const { buildResultDoc, postResult, savePending, submitPending, listPending } = require(path.join(CORE, 'submit'));

const STUDENT_FILE = path.join(KIT_DIR, '.student.json');
const PENDING_DIR = path.join(KIT_DIR, '.pending');

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function loadKitConfig({ optional = false } = {}) {
  const file = path.join(KIT_DIR, 'config.json');
  if (!fs.existsSync(file)) {
    if (optional) return null;
    die('This kit has no config.json. Ask the invigilator for a fresh kit.');
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!cfg.collectorUrl || !cfg.collectorKey) die('This kit has an incomplete config.json. Ask the invigilator for a fresh kit.');
  return cfg;
}

function loadSets() {
  const list = JSON.parse(fs.readFileSync(path.join(KIT_DIR, 'sets.json'), 'utf8'));
  return list.map((entry) =>
    typeof entry === 'string' ? JSON.parse(fs.readFileSync(path.join(KIT_DIR, '..', '..', 'domains', `${entry}.json`), 'utf8')) : entry,
  );
}

// Line reader that buffers input, so answers typed (or piped) ahead of the next question are not lost.
function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question) {
      process.stdout.write(question);
      const next = await lines.next();
      return next.done ? null : next.value;
    },
    close: () => rl.close(),
  };
}

function readStudentFile() {
  try {
    return JSON.parse(fs.readFileSync(STUDENT_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

// Asks (up to 5 times) until isValid(answer) is true. Returns null when nothing valid was entered.
async function askUntilValid(prompt, question, isValid, retryMessage) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const answer = await prompt.ask(question);
    if (answer === null) return null;
    if (isValid(answer)) return answer;
    console.log(retryMessage);
  }
  return null;
}

const PIN_REGEX = /^\d{6}$/;

// The laptop's hardware id (stays the same if the kit is unzipped again or moved), or a random id saved in
// the home folder when it cannot be read. Only a hash is sent; the collector binds it to the first student
// who logs in from this laptop.
function machineId() {
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    if (process.platform === 'darwin') return (run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).match(/"IOPlatformUUID" = "([^"]+)"/) || [])[1];
    if (process.platform === 'win32') return (run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']).match(/MachineGuid\s+REG_SZ\s+(\S+)/) || [])[1];
    for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  } catch {
    // fall through to the saved random id
  }
  return null;
}

function getDeviceId() {
  let id = machineId();
  if (!id) {
    const file = path.join(os.homedir(), '.assessment-kit-device');
    try {
      id = fs.readFileSync(file, 'utf8').trim();
    } catch {
      id = '';
    }
    if (!id) {
      id = crypto.randomUUID();
      try {
        fs.writeFileSync(file, id + '\n');
      } catch {
        // home folder not writable: the id lasts for this run only
      }
    }
  }
  return crypto.createHash('sha256').update(`assessment-kit-device|${id}`).digest('hex').slice(0, 32);
}

const LAPTOP_CODES = new Set(['LAPTOP_TAKEN', 'SECOND_LAPTOP', 'PIN_LOCKED']);

// Asks the collector whether this registration number is on the class list and the PIN matches.
// kind: 'ok' (with name), 'rejected' (with message), 'unreachable'.
async function verifyStudent(kit, reg, pin) {
  if (!kit) return { kind: 'unreachable' };
  const url = `${kit.collectorUrl.replace(/\/+$/, '')}/api/verify-student`;
  const r = await postResult(url, { registrationNumber: reg, pin, deviceId: getDeviceId() }, { 'x-collector-key': kit.collectorKey });
  if (r.kind === 'ok') return { kind: 'ok', name: (r.body && r.body.name) || '' };
  if (r.kind === 'rejected' && r.status === 404) die("The trainer's collector is out of date (it cannot check PINs). Tell the invigilator.");
  if (r.kind === 'rejected' && (r.status === 401 || LAPTOP_CODES.has(r.code))) die(r.message);
  return r;
}

// Returns { reg, pin, setId, name }. The student enters them once (registration number and PIN from their
// slip, set from their question paper); they are checked with the collector and saved in .student.json.
// change = true asks again even if they are saved.
async function getStudent(sets, kit, change = false) {
  const setIds = sets.map((s) => s.setId);
  const inKit = (answer) => isValidSet(answer) && setIds.includes(normalizeSet(answer));
  const saved = change ? {} : readStudentFile();
  let reg = isValidReg(saved.registrationNumber || '') ? normalizeReg(saved.registrationNumber) : null;
  let pin = PIN_REGEX.test(saved.pin || '') ? saved.pin : null;
  let setId = saved.setId && inKit(saved.setId) ? normalizeSet(saved.setId) : null;
  if (reg && pin && setId) return { reg, pin, setId, name: '', fromFile: true };

  let name = '';
  const prompt = createPrompt();
  try {
    for (let attempt = 0; !(reg && pin); attempt++) {
      if (attempt >= 3) die('Registration number and PIN not accepted. Tell the invigilator.');
      if (!reg) {
        const answer = await askUntilValid(prompt, 'Enter your registration number: ', isValidReg,
          'That does not look like a registration number (4-20 letters, digits, . _ / -). Try again.');
        if (answer === null) die('No registration number entered.');
        reg = normalizeReg(answer);
      }
      if (!pin) {
        const answer = await askUntilValid(prompt, 'Enter the 6-digit PIN on your slip: ', (a) => PIN_REGEX.test(a.trim()),
          'The PIN is 6 digits, as printed on your slip. Try again.');
        if (answer === null) die('No PIN entered.');
        pin = answer.trim();
      }
      const v = await verifyStudent(kit, reg, pin);
      if (v.kind === 'ok') name = v.name;
      else if (v.kind === 'unreachable') console.log("Could not reach the trainer's collector to check your PIN. It is checked again when you run npm run evaluate.");
      else {
        console.log(v.message);
        reg = null;
        pin = null;
      }
    }
    if (!setId) {
      const answer = await askUntilValid(prompt, `Enter the set printed on your question paper (${setIds.join(', ')}): `, inKit,
        `That is not a set in this kit. Type it exactly as on your question paper, for example ${setIds[0]}.`);
      if (answer === null) die('No set entered.');
      setId = normalizeSet(answer);
    }
  } finally {
    prompt.close();
  }
  fs.writeFileSync(STUDENT_FILE, JSON.stringify({ registrationNumber: reg, pin, setId }, null, 2) + '\n');
  return { reg, pin, setId, name };
}

function parseOptions(argv) {
  const out = { url: 'http://localhost:8080', wait: 60 };
  for (let i = 0; i < argv.length; i++) {
    const [k, inline] = argv[i].split('=', 2);
    const val = () => (inline !== undefined ? inline : argv[++i]);
    if (k === '--url') out.url = val();
    else if (k === '--wait') out.wait = Number(val());
    else die(`Unknown option ${argv[i]}. Usage: npm run evaluate -- [--url http://localhost:8080] [--wait 60]`);
  }
  if (!out.url || !/^https?:\/\//.test(out.url)) die('--url must start with http:// or https://');
  if (!Number.isFinite(out.wait) || out.wait < 0) die('--wait must be a number of seconds');
  return out;
}

async function retryPending(kit) {
  const outcomes = await submitPending(PENDING_DIR, kit.collectorUrl, kit.collectorKey);
  for (const o of outcomes) {
    if (o.kind === 'ok') console.log(`A result saved earlier has now been recorded (run id ${o.runId}).`);
    else if (o.kind === 'rejected') console.log(`A result saved earlier was not accepted: ${o.message}`);
  }
  return outcomes;
}

async function evaluate(argv) {
  const opts = parseOptions(argv);
  const kit = loadKitConfig();
  const sets = loadSets();
  const { reg, pin, setId, fromFile } = await getStudent(sets, kit);
  const config = sets.find((s) => s.setId === setId);
  if (fromFile) {
    // saved earlier: check again before spending time on the run (a rejected result cannot be resent)
    const v = await verifyStudent(kit, reg, pin);
    if (v.kind === 'rejected') die(v.message);
  }

  await retryPending(kit);

  const url = opts.url.replace(/\/+$/, '');
  console.log(MESSAGES.start(url));
  const isTTY = process.stdout.isTTY;
  const run = await runSet({
    config,
    url,
    seed: randomSeed(),
    waitSeconds: opts.wait,
    onProgress: (n, total) => {
      if (isTTY) process.stdout.write(`\r${MESSAGES.progress(n, total)}`);
      else if (n % 25 === 0 || n === total) console.log(MESSAGES.progress(n, total));
    },
  });
  if (isTTY && run.status === 'COMPLETED') process.stdout.write('\n');

  if (run.status === 'ABORTED') {
    // nothing is scored or submitted
    die(renderStudent({ kind: 'aborted', reason: run.abortReason, url }));
  }

  console.log(renderChecks(run.results, GROUPS));

  const doc = buildResultDoc({ run, registrationNumber: reg, mode: 'assessment', key: kit.collectorKey, extra: { pin, deviceId: getDeviceId() } });
  const r = await postResult(`${kit.collectorUrl.replace(/\/+$/, '')}/api/results`, doc, { 'x-collector-key': kit.collectorKey });
  if (r.kind === 'ok') {
    console.log(renderStudent({ kind: 'recorded', runId: doc.runId }));
    return;
  }
  if (r.kind === 'rejected') die(renderStudent({ kind: 'rejected', message: r.message }));
  savePending(PENDING_DIR, kit.collectorKey, doc);
  die(renderStudent({ kind: 'pending' }), 2);
}

async function whoami(argv) {
  const change = argv.includes('--change');
  const unknown = argv.filter((a) => a !== '--change');
  if (unknown.length) die(`Unknown option ${unknown[0]}. Usage: npm run whoami [-- --change]`);
  const sets = loadSets();
  const { reg, setId, name } = await getStudent(sets, loadKitConfig({ optional: true }), change);
  const config = sets.find((s) => s.setId === setId);
  console.log(`Registration number: ${reg}${name ? ` (${name})` : ''}`);
  console.log(`Your set is ${setId} (${config.title})`);
  if (change) console.log('Saved. Your next npm run evaluate uses this set and sends it to your trainer.');
  else console.log('If anything is wrong, run: npm run whoami -- --change');
}

async function submitPendingCmd() {
  const kit = loadKitConfig();
  if (listPending(PENDING_DIR).length === 0) {
    console.log('Nothing to send. Every result on this computer has been recorded.');
    return;
  }
  const outcomes = await submitPending(PENDING_DIR, kit.collectorUrl, kit.collectorKey);
  let stillPending = false;
  for (const o of outcomes) {
    if (o.kind === 'ok') console.log(renderStudent({ kind: 'recorded', runId: o.runId }));
    else if (o.kind === 'rejected') console.log(renderStudent({ kind: 'rejected', message: o.message }));
    else if (o.kind === 'unreadable') console.log(`A saved file could not be read (${path.basename(o.file)}). Tell the invigilator.`);
    else stillPending = true;
  }
  if (stillPending) die(renderStudent({ kind: 'pending' }), 2);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = { evaluate: () => evaluate(rest), whoami: () => whoami(rest), 'submit-pending': submitPendingCmd };
if (!commands[cmd || 'evaluate']) die('Commands: npm run evaluate | npm run whoami | npm run submit-pending');
commands[cmd || 'evaluate']().catch((err) => die(`Unexpected problem: ${err.message}. Tell the invigilator.`));
