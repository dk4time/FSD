'use strict';
// The "no marks shown" promise: the kit prints each check as PASS or FAIL, but never marks,
// counts or detail, and never stores a readable result.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { assembleKit, scanKit, listFiles, makeZip } = require('../scripts/build-kits');
const { startReference, freePort } = require('../trainer-only/refproc');
const { loadConfig } = require('../trainer-only/reference/server');
const { verifyChecksum } = require('../collector/server');

const REVEALS = /PASS|FAIL|BLOCKED|score|passed|failed|\b\d{1,3}\s*\/\s*100\b/i;
const REVEALS_MARKS = /BLOCKED|score|passed|failed|\b\d{1,3}\s*\/\s*100\b|got:|sent:|\b[A-Z]\d{2}\b/;
const REG = '22CS001';
const SET = 'A6'; // the only set in the test kit
const PIN = '246810'; // the fake collector accepts only this PIN
const KEY = 'kit-test-key';

let dir;
let collector;
let collectorPort;
const received = [];
const verifyDevices = [];
let laptopTaken = false;

function startCollector(port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/verify-student') {
          const { pin, deviceId } = JSON.parse(body);
          verifyDevices.push(deviceId);
          if (laptopTaken) {
            res.statusCode = 403;
            return res.end('{"error":"This laptop is already registered to another student. Each student must use their own laptop. Tell the invigilator.","code":"LAPTOP_TAKEN"}');
          }
          if (pin === PIN) return res.end('{"ok":true,"name":"Asha K"}');
          res.statusCode = 403;
          return res.end('{"error":"The PIN does not match this registration number. Check your PIN slip and run npm run whoami -- --change."}');
        }
        received.push({ headers: req.headers, doc: JSON.parse(body) });
        res.end('{"ok":true}');
      });
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

function runKit(args, input = '') {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['cli.js', ...args], { cwd: dir });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function newFiles(beforeList) {
  return listFiles(dir).filter((f) => !beforeList.includes(f));
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-'));
  collectorPort = await freePort();
  // P1's contract served by the P1 reference, presented to the kit as the student's set A6
  const set = { ...loadConfig('P1'), setId: 'A6', mode: 'assessment', title: 'Kit test set' };
  assembleKit(dir, { sets: [set], collectorUrl: `http://127.0.0.1:${collectorPort}`, collectorKey: KEY });
  collector = await startCollector(collectorPort);
});

after(() => {
  if (collector) collector.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assembled kit passes the secrets scan and has no dependencies', () => {
  assert.deepEqual(scanKit(dir), []);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(!fs.existsSync(path.join(dir, 'domains')));
});

test('secrets scan catches forbidden content', () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-bad-'));
  try {
    fs.mkdirSync(path.join(bad, 'domains'));
    fs.writeFileSync(path.join(bad, 'domains', 'P1.json'), '{}');
    fs.writeFileSync(path.join(bad, 'x.js'), 'const uri = process.env.MONGODB_URI;');
    const problems = scanKit(bad).join('\n');
    assert.match(problems, /practice domain file/);
    assert.match(problems, /mongodb/i);
  } finally {
    fs.rmSync(bad, { recursive: true, force: true });
  }
});

test('zip writer output is readable by unzip', { skip: !fs.existsSync('/usr/bin/unzip') }, async () => {
  const zipPath = path.join(dir, '..', `kit-${process.pid}.zip`);
  fs.writeFileSync(zipPath, makeZip([{ name: 'a/b.txt', data: Buffer.from('hello zip') }]));
  const out = await new Promise((resolve) => {
    const c = spawn('/usr/bin/unzip', ['-p', zipPath, 'a/b.txt']);
    let s = '';
    c.stdout.on('data', (d) => (s += d));
    c.on('close', () => resolve(s));
  });
  fs.rmSync(zipPath);
  assert.equal(out, 'hello zip');
});

for (const mutant of ['', 'M07']) {
  test(`kit output reveals nothing against the reference${mutant ? ` mutant ${mutant}` : ''}`, async () => {
    const ref = await startReference('P1', mutant);
    const filesBefore = listFiles(dir);
    try {
      const n = received.length;
      const r = await runKit(['evaluate', '--url', ref.url, '--wait', '10'], `${REG}\n${PIN}\n${SET}\n`);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, REVEALS_MARKS, r.stdout);
      assert.doesNotMatch(r.stderr, REVEALS, r.stderr);
      const checkLines = r.stdout.split('\n').filter((l) => /^(PASS|FAIL)  \S/.test(l));
      assert.equal(checkLines.length, 100, 'one PASS/FAIL line per check');
      assert.match(r.stdout, /^-- Create \(POST\) --$/m);
      if (mutant) assert.ok(checkLines.some((l) => l.startsWith('FAIL')));
      else assert.ok(checkLines.every((l) => l.startsWith('PASS')));
      assert.match(r.stdout, /Checking your API at /);
      assert.match(r.stdout, /Running checks: \d+ of 100 attempted/);
      assert.match(r.stdout, /Submission recorded\. Your result has been sent to your trainer\./);

      assert.equal(received.length, n + 1);
      const { doc, headers } = received[n];
      assert.equal(headers['x-collector-key'], KEY);
      assert.equal(doc.registrationNumber, REG);
      assert.equal(doc.pin, PIN);
      assert.match(doc.deviceId, /^[0-9a-f]{32}$/);
      assert.ok(verifyDevices.length > 0 && verifyDevices.every((d) => d === doc.deviceId), 'same laptop id on every call');
      assert.equal(doc.setId, 'A6');
      assert.equal(doc.mode, 'assessment');
      assert.equal(doc.tests.length, 100);
      assert.ok(verifyChecksum(KEY, doc));
      const passed = doc.tests.filter((t) => t.status === 'PASS').length;
      if (mutant) assert.ok(passed < 100);
      else assert.equal(passed, 100);

      // no file written by the run contains a readable result
      for (const f of newFiles(filesBefore)) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        assert.doesNotMatch(text, REVEALS, `${f} reveals a result`);
      }
    } finally {
      await ref.stop();
    }
  });
}

test('whoami prints the saved registration number and set', async () => {
  const r = await runKit(['whoami']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Registration number: 22CS001/);
  assert.match(r.stdout, /Your set is A6 \(Kit test set\)/);
  assert.doesNotMatch(r.stdout, /Enter/, 'nothing is asked again once saved');
});

test('whoami --change asks again and only accepts a set that is in the kit', async () => {
  // a wrong PIN is caught at once and asked again; then two sets that are not in the kit
  const r = await runKit(['whoami', '--change'], `23ec090\n111111\n23ec090\n${PIN}\nA9\nP1\na6\n`);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/That is not a set in this kit/g) || []).length, 2);
  assert.match(r.stdout, /The PIN does not match this registration number/);
  assert.match(r.stdout, /Registration number: 23EC090 \(Asha K\)/);
  assert.match(r.stdout, /Your next npm run evaluate uses this set/);
  assert.match(r.stdout, /Your set is A6/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, '.student.json'), 'utf8'));
  assert.deepEqual(saved, { registrationNumber: '23EC090', pin: PIN, setId: 'A6' });
  // put the original student back for the tests that follow
  await runKit(['whoami', '--change'], `${REG}\n${PIN}\n${SET}\n`);
});

test('a saved file from an older kit asks only for what is missing (PIN and set)', async () => {
  fs.writeFileSync(path.join(dir, '.student.json'), JSON.stringify({ registrationNumber: REG }));
  const r = await runKit(['whoami'], `${PIN}\n${SET}\n`);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Enter your registration number/);
  assert.match(r.stdout, /Enter the 6-digit PIN/);
  assert.match(r.stdout, /Your set is A6/);
});

test('a laptop rejection stops whoami at once (no new PIN prompt)', async () => {
  laptopTaken = true;
  const file = path.join(dir, '.student.json');
  const good = fs.readFileSync(file, 'utf8');
  try {
    const r = await runKit(['whoami', '--change'], `${REG}\n${PIN}\n${REG}\n${PIN}\n`);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /already registered to another student/);
    assert.equal((r.stdout.match(/Enter the 6-digit PIN/g) || []).length, 1);
  } finally {
    laptopTaken = false;
    fs.writeFileSync(file, good);
  }
});

test('evaluate re-checks a saved PIN and stops before running checks when it is wrong', async () => {
  const file = path.join(dir, '.student.json');
  const good = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, JSON.stringify({ registrationNumber: REG, pin: '111111', setId: SET }));
  const n = received.length;
  try {
    const r = await runKit(['evaluate', '--url', 'http://127.0.0.1:9', '--wait', '1']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /The PIN does not match/);
    assert.doesNotMatch(r.stdout, /Checking your API/);
    assert.equal(received.length, n);
  } finally {
    fs.writeFileSync(file, good);
  }
});

test('kit refuses unknown options', async () => {
  for (const opt of ['--set', '--seed', '--only', '--no-submit', '--reg', '--verbose']) {
    const r = await runKit(['evaluate', opt, 'x']);
    assert.notEqual(r.code, 0, opt);
    assert.match(r.stderr, /Unknown option/);
  }
});

test('preflight messages: server not reachable / not empty (nothing submitted)', async () => {
  const n = received.length;
  const port = await freePort();
  let r = await runKit(['evaluate', '--url', `http://127.0.0.1:${port}`, '--wait', '1']);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Cannot reach your server at/);

  const ref = await startReference('P1', '');
  try {
    await fetch(`${ref.url}/api/products`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(loadConfig('P1').sample) });
    r = await runKit(['evaluate', '--url', ref.url, '--wait', '5']);
    assert.match(r.stderr, /Your server is not empty\. Restart it so it starts with no data\./);
  } finally {
    await ref.stop();
  }
  assert.equal(received.length, n);
});

test('collector unreachable: result saved encrypted, then sent by submit-pending', async () => {
  collector.close();
  await new Promise((r) => setTimeout(r, 100));
  const ref = await startReference('P1', '');
  try {
    const r = await runKit(['evaluate', '--url', ref.url, '--wait', '10']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /Your result is saved on this computer but NOT recorded yet\. Tell the invigilator, then run npm run submit-pending\./);
    assert.doesNotMatch(r.stdout + r.stderr, REVEALS_MARKS);
  } finally {
    await ref.stop();
  }
  const pending = fs.readdirSync(path.join(dir, '.pending'));
  assert.equal(pending.length, 1);
  const blob = fs.readFileSync(path.join(dir, '.pending', pending[0]), 'utf8');
  assert.throws(() => JSON.parse(blob), 'pending file must not be plain JSON');
  assert.doesNotMatch(blob, REVEALS);

  collector = await startCollector(collectorPort);
  const n = received.length;
  const s = await runKit(['submit-pending']);
  assert.equal(s.code, 0, s.stdout + s.stderr);
  assert.match(s.stdout, /Submission recorded/);
  assert.equal(received.length, n + 1);
  assert.equal(fs.readdirSync(path.join(dir, '.pending')).length, 0);
});
