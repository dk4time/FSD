# Assessment platform

Automated marking for a REST-API-without-a-database assessment (Express or Spring Boot). The platform has
2 practice sets (P1, P2) and 8 assessment sets (A1–A8), and each set has 100 automated tests.

```
 Student laptop                                   Trainer laptop                     Cloud
 ┌──────────────────────┐   HTTP (localhost)      ┌────────────────────┐   driver   ┌───────────┐
 │ student's API (8080) │ <────────────────────── │                    │            │           │
 │ evaluator kit (Node) │ ── results over WiFi ─> │ collector (Express)│ ─────────> │ MongoDB   │
 └──────────────────────┘   x-collector-key       │ + /admin dashboard │            │ Atlas     │
                                                  └────────────────────┘            └───────────┘
```

| | Practice (P1, P2) | Assessment (A1–A8) |
|---|---|---|
| Students get | the question paper only, and test with Postman or curl | the paper plus `dist/assessment-kit.zip`, which shows each test as PASS/FAIL but **no marks** |
| The trainer sees marks in | `npm run trainer -- --set P1 --url <student url>` | the `/admin` dashboard (Atlas), plus `npm run trainer` to re-run a student's code |

## Please read: this is not secure

The assessment kit runs on student laptops, so a determined student can read its source code. That
includes the test logic, the shared collector key and the key that encrypts the pending queue. The
following make cheating harder but do not prevent it:

- randomised test data
- only students on the roster can submit, and only with the PIN printed on their slip (checked on the server)
- one laptop per student: the first laptop that logs in is bound to the registration number (checked on the server)
- an HMAC checksum on the payload
- an AES-encrypted pending queue
- a collector that never returns scores

To catch cheating, spot-check students: re-run their code with `npm run trainer -- --set <set> --url ... --reg <reg> --save`
(the dashboard shows the re-run next to the student's own score) and ask them to explain an endpoint.
Practice evaluation is fully private, because practice students never get any evaluator code.

## Setup (trainer laptop)

```
npm install                       # also installs collector/ (postinstall)
cp collector/.env.example collector/.env   # fill in MONGODB_URI, COLLECTOR_KEY, ADMIN_PASSWORD, PIN_SECRET
npm run check-atlas               # prints OK and the database name, or a readable error
npm run collector                 # prints the LAN URL students submit to and the /admin URL
```

Atlas: create a free cluster and a database user with `readWrite` on `webdev_assessment` only. Then add
your laptop's IP under Network Access. **The connection string goes only in `collector/.env`**, which is
git-ignored and never copied into a kit.

## Commands

| Command | What it does |
|---|---|
| `npm test` | unit tests (generator invariants for every set over 200 seeds, model, registration/set validation, checksum, BLOCKED/ABORT logic, "kit shows no marks", pending encryption) and collector tests (mongodb-memory-server) |
| `npm run verify -- --set P1` | reference server 100/100 on 3 seeds, every applicable mutant caught, ABORT checks; prints the mutant matrix |
| `npm run trainer -- --set A3 --url http://10.0.0.7:8080 [--seed N] [--only C01,C02] [--wait 60] [--reg 22CS001 --save --note "..."]` | full-detail evaluation of any set; `--save` stores a **trainer run** (separate `trainerRuns` collection, never changes the student's summary) |
| `PUBLIC_COLLECTOR_URL=http://<lan-ip>:4000 npm run build-kits` | builds `dist/assessment-kit.zip` with the sets listed in `kits/assessment/sets.json`, runs the secrets scan and prints the file list |
| `npm run check-atlas` | tests the Atlas connection |
| `npm run reference` | `SET_ID=P1 [MUTANT=M07] PORT=8080`: the correct reference API, or one deliberate bug |

Students run `npm run whoami` (they enter their registration number and PIN from their slip, and the set printed on
the question paper they were handed; `-- --change` corrects it), `npm run evaluate [-- --url ...] [--wait 60]` and `npm run submit-pending`
inside the unzipped kit, with **no `npm install`**.

## How a run works

1. **Preflight.** The evaluator polls `GET /api/<resource>` for up to 60 s (`--wait`). If the server is
   unreachable, or the list already shows records, the run is **ABORTED**. Nothing is scored and nothing is
   submitted.
2. **Seed phase.** The evaluator POSTs 45 generated records, then runs the read-only groups, then the
   mutating groups (each test creates its own scratch record), and runs the negative creates last.
3. **Scoring.** A test scores only if it passes. If fewer than 40 seed POSTs work, every test except C01–C14
   and H02 is **BLOCKED**, so the student sees the root cause instead of 80 identical failures. The whole run
   is capped at 180 s, with 5 s per request.
4. **Expected values.** Every expected value comes from the evaluator's own in-memory model (`core/model.js`),
   never from what the server returned.

## Layout

```
core/            shared engine (copied into the kit): engine, http, rng, generator, model, tests/, assign, report, submit, version
domains/         one JSON config per set (P1 now, the others are added by the set prompts)
kits/assessment/ the kit students receive (cli.js, package.json, README.md, sets.json = list of set ids)
collector/       Express + MongoDB collector, /admin dashboard, tests
trainer-only/    trainer-cli, render (full-detail output), reference server + mutants, verify
scripts/         build-kits (zip writer + secrets scan), read-env
test/            root unit tests
```

## Design notes and deviations

- **`renderTrainer` lives in `trainer-only/render.js`, not in `core/report.js`.** The build rule forbids
  the text `renderTrainer` anywhere in the kit, so `core/report.js` only has `renderStudent()` and the fixed
  student messages.
- **Empty-server check.** The run ABORTs when the first list response *shows records* (`total > 0`, or a
  non-empty `data` array or bare array). It does not ABORT when the list is not implemented yet (for
  example a 404 or a different shape), because those students would otherwise never get a result recorded.
  Their list tests fail instead.
- **`kits/assessment/sets.json`** in the repo is a list of set ids (`["A1", …]`). The set prompts append to
  it. `build-kits` writes the full configs into the zip.
- **The kit is also runnable in the repo** (it falls back to `../../core` and `../../domains`). It still
  needs a `config.json`, which only `build-kits` writes.
- **Sets are handed out manually.** The set is not derived from the registration number: the trainer hands out
  the question papers, and the student enters that set in `npm run whoami`. The collector accepts any set A1–A8
  for any registration number, and a student's set on the dashboard is the set of their latest run.
- **Roster and PINs.** The collector accepts results only for registration numbers on the roster (dashboard ->
  Upload roster CSV, `reg,name,section`), and only with that student's 6-digit PIN. A PIN is derived from the
  registration number and `PIN_SECRET` (collector/.env only), so nothing extra is stored; changing `PIN_SECRET`
  changes every PIN. Before the exam: upload the roster, open **PIN slips** on the dashboard, print and hand them out.
  `npm run whoami` checks the PIN with the collector at once (`POST /api/verify-student`), and `npm run evaluate`
  checks it again before running. Five wrong PINs for one registration number from one laptop lock that pair for
  15 minutes (20 per laptop in total). Trainer re-runs (`npm run trainer -- --save`) need no PIN.
- **Slots (one per assessment session).** Each roster upload asks for a slot name (for example
  `sist-15-10-26-fn`) and tags those students with it. Only students of an **open** slot can log in or submit;
  everyone else gets `SLOT_CLOSED`, so a kit picked up from a shared drive after (or before) the session is useless.
  A new slot starts closed: on the dashboard's **Slots** tab, open it when the session starts and close it when
  time is up, or give it a closing time and it closes by itself. A student with no slot counts as closed.
  Re-uploading a roster with the same slot keeps the slot open or closed; with another slot it moves the students.
- **One laptop per student.** The kit sends a laptop id (a hash of the machine's hardware id: macOS
  IOPlatformUUID, Windows MachineGuid, Linux machine-id; otherwise a random id kept in `~/.assessment-kit-device`),
  so it stays the same when the kit is unzipped again. The first laptop that logs in with the right PIN is bound
  to that registration number (stored on the roster entry). That number from another laptop, or that laptop for
  another number (a shared PIN), is **rejected** and listed under **Laptop conflicts** on the dashboard. For a genuine
  laptop change, open the student and press **Reset laptop**. Re-uploading the roster keeps the bindings. The kit
  runs on the student's laptop, so a determined student could fake the id; this stops casual PIN sharing.
- **Rate limit.** One submission per registration number per 20 s. A 429 is final like any other 4xx: the
  student waits and runs again, and the result is not queued.
- **Pending queue.** `.pending/<runId>.json` holds base64 of AES-256-GCM ciphertext, with the key derived from
  the collector key. It is a deterrent only.
- **CSV export** adds `name`, `section` and `slot` (from the roster) to the documented columns and starts with a
  UTF-8 BOM so Excel opens it correctly.
