# Prompt 00 — CORE: build the assessment platform

Run this **first**, in an empty folder named `assessment-platform`, using Claude Code.
Prompts P1, P2 and A1–A8 come after it and each add one question set to this platform.

---

## 1. Goal

A trainer runs a web-development assessment for 100+ students. Each student builds a
**REST API without a database** (Express or Spring Boot) from scratch, from a printed question
paper. There are 2 **practice sets** (P1, P2) and 8 **assessment sets** (A1–A8).

- **Practice sets: students get NO evaluator.** They only get the question paper (which describes the marking scheme and how evaluation works) and test their API by hand with Postman or curl. The practice sets exist in the platform so the **trainer** can run the evaluator against students' practice work.
- **Assessment sets:** on assessment day each student gets a small sealed **assessment kit** and runs it on their own laptop. The kit calls the student's running API with **100 automated test cases** and sends the result to a **collector** on the trainer's laptop, which stores everything in **MongoDB Atlas**. **The kit never shows marks, scores or per-test results.** When it finishes it prints only a success message (section 6.5).
- **Trainer evaluator:** a full-detail command that only the trainer has (`trainer-only/`). It prints score, per-test status and expected-versus-actual detail, works for any of the 10 sets, and can re-run any student's code to check a submitted result.

```
 Student laptop                                   Trainer laptop                     Cloud
 ┌──────────────────────┐   HTTP (localhost)      ┌────────────────────┐   driver   ┌───────────┐
 │ student's API (8080) │ <────────────────────── │                    │            │           │
 │ evaluator kit (Node) │ ── results over WiFi ─> │ collector (Express)│ ─────────> │ MongoDB   │
 └──────────────────────┘   x-collector-key       │ + /admin dashboard │            │ Atlas     │
                                                  └────────────────────┘            └───────────┘
```

**The Atlas connection string lives only in the collector's `.env` on the trainer's laptop.**
It must never appear in any file given to students. Students' kits contain only the collector URL
and a shared key.

**Be honest in the README and in your final summary:** the assessment kit runs on student machines, so a
determined student can read its source. Randomised test data, server-side set assignment, a payload checksum,
an obfuscated pending queue and the collector never returning scores are deterrents, not security. Say this plainly.
Practice evaluation is fully private because practice students never receive any evaluator code.

## 2. Stack and constraints

- Node.js >= 18 (use built-in `fetch`, `crypto`, `readline`, `node:test`). Plain JavaScript (CommonJS), no TypeScript.
- **The student kits must have zero npm dependencies** (Spring Boot students only need Node installed).
- Collector dependencies: `express`, `mongodb`, `dotenv`. Dev dependency: `mongodb-memory-server` (collector tests).
- Reference server (trainer-only): `express` only.
- No test framework for the 100 tests: write a small runner (section 8).

## 3. Repository layout (create exactly this)

```
assessment-platform/
  package.json                  # scripts: test, verify, build-kits, find-reg, check-atlas, trainer
  README.md
  core/
    engine.js                   # runs a set, returns results
    http.js                     # request helper (timeout 5s, never throws)
    rng.js                      # mulberry32 seeded PRNG
    generator.js                # seed dataset + invalid payloads from a domain config
    model.js                    # reference model of the contract (query semantics)
    tests/                      # one file per group: create.js readOne.js list.js update.js patch.js delete.js pagination.js filter.js search.js sort.js combined.js http.js
    assign.js                   # registration number -> assessment set
    report.js                   # terminal output: renderTrainer() full detail, renderStudent() success message only
    submit.js                   # POST to collector, pending queue
    version.js                  # exports EVALUATOR_VERSION = "1.0.0"
  domains/                      # <SETID>.json, one per question set (added by prompts P1..A8)
  kits/
    assessment/ { cli.js, sets.json, package.json, README.md }     # the only kit students receive
  collector/
    server.js  db.js  assign.js  summary.js  admin/ (index.html + app.js)  .env.example  package.json  test/
  trainer-only/
    trainer-cli.js              # full-detail evaluator for any set (section 6.6)
    reference/server.js         # correct reference API + mutants (section 12)
    verify.js                   # npm run verify -- --set P1
    find-reg.js                 # npm run find-reg -- --set A3
  scripts/build-kits.js
  dist/                         # build output: assessment-kit.zip only (gitignored)
```

`core/` is shared. `build-kits.js` copies `core/` into the assessment kit; **students never get**
`trainer-only/`, `collector/`, `.env` files, or any practice domain (P1, P2).

## 4. Domain config (the shared source of truth)

Every question set is one JSON file in `domains/`. The question papers were generated from these
same files, so field names, bounds and parameter names must be taken **only** from the config.
Schema:

| Key | Meaning |
|---|---|
| `setId`, `mode`, `title`, `resource` | e.g. `P1`, `practice` or `assessment` (which paper family the set belongs to), `Product Catalog`, `products` (path is `/api/<resource>`) |
| `text1` | `{name,minLen,maxLen}` required string; **searchable and sortable** |
| `text2` | `{name,minLen,maxLen}` required string; **searchable** |
| `enum` | `{name,values[]}` required string, exact match, case-sensitive; **filterable** |
| `amount` | `{name,exclusiveMin:0,max,genMin,genDecimals,rangeFilter:[minParam,maxParam]}` required number > 0 and <= max; range filter + **sortable**. `genMin`/`genDecimals` are for data generation only, they are NOT validation rules |
| `count` | `{name,min,max}` required integer in [min,max]; **sortable** |
| `flag` | `{name}` required JSON boolean; **filterable** (`true`/`false`) |
| `uniqueCode` | `null`, or `{name,minLen,maxLen}` required string, unique across records ignoring letter case |
| `sample` | one valid record (for papers; the evaluator never uses it as test data) |
| `sortFields` | the three allowed `sort` values: text1, amount, count |

Create `domains/P1.json` now with exactly this content (it is the worked example used to build the engine; prompt P1 re-checks it):

```json
{
  "setId": "P1",
  "mode": "practice",
  "title": "Product Catalog",
  "resource": "products",
  "text1": {
    "name": "name",
    "minLen": 3,
    "maxLen": 60,
    "searchable": true,
    "sortable": true
  },
  "text2": {
    "name": "brand",
    "minLen": 2,
    "maxLen": 40,
    "searchable": true
  },
  "enum": {
    "name": "category",
    "values": [
      "Electronics",
      "Books",
      "Clothing",
      "Home",
      "Sports"
    ],
    "filterable": true
  },
  "amount": {
    "name": "price",
    "exclusiveMin": 0,
    "max": 100000,
    "genMin": 1,
    "genDecimals": 2,
    "rangeFilter": [
      "minPrice",
      "maxPrice"
    ],
    "sortable": true
  },
  "count": {
    "name": "stock",
    "integer": true,
    "min": 0,
    "max": 10000,
    "sortable": true
  },
  "flag": {
    "name": "inStock",
    "filterable": true
  },
  "uniqueCode": null,
  "sample": {
    "name": "Wireless Mouse",
    "brand": "Logitech",
    "category": "Electronics",
    "price": 799.5,
    "stock": 40,
    "inStock": true
  },
  "sortFields": [
    "name",
    "price",
    "stock"
  ]
}
```

## 5. The HTTP contract (normative — the reference server and the evaluator both implement exactly this)

Base path `/api/<resource>`. All bodies are JSON. Port comes from `PORT` (default 8080).

**Fields.** `id` is server-generated (number or string), unique, never taken from the body. Strings are trimmed; blank after trimming is invalid. Booleans must be JSON booleans. The integer field must be a whole JSON number. The amount must be a JSON number with `0 < amount <= max`. The enum must match exactly. Unknown body fields are ignored (not stored, not returned). If `uniqueCode` exists, a duplicate (case-insensitive) on create/PUT/PATCH is **409**; a record may keep its own value.

| Method / path | Behaviour |
|---|---|
| `POST /api/<r>` | validate all required fields → `201` + created record (with `id`). Invalid → `400`. Duplicate unique → `409` |
| `GET /api/<r>/:id` | `200` + record, or `404` |
| `PUT /api/<r>/:id` | all required fields needed, replaces the record, keeps the id → `200`; unknown id → `404` (never creates); invalid → `400`; duplicate of *another* record's unique code → `409` |
| `PATCH /api/<r>/:id` | at least one recognised field (empty body `{}` → `400`); each sent field validated as in POST; `200` + full updated record; unknown id → `404`; `id` cannot change |
| `DELETE /api/<r>/:id` | `204` with an empty body; unknown id → `404` |
| `GET /api/<r>` | list (below) |

**List.** Processing order: filter → search → sort → paginate. Filters and search combine with AND.

| Param | Rules |
|---|---|
| `page` | positive integer, default 1; else `400`; beyond the last page → `200` with empty `data` |
| `limit` | positive integer, **max 50**, default 10; else `400` |
| `search` | case-insensitive "contains" on text1 **or** text2; empty value = no search |
| `<enum.name>` | exact enum value; unknown value → `400` |
| `<flag.name>` | `true` or `false`; else `400` |
| `<minParam>`, `<maxParam>` | inclusive; must be numbers else `400`; min > max → `200`, empty result |
| `sort` | one of `sortFields`, else `400`; text compared ignoring letter case; without `sort`, creation order |
| `order` | `asc` (default) or `desc`; else `400` |

Response: `{ "data": [...], "page", "limit", "total", "totalPages" }`, `total` = matches after filters/search before paging, `totalPages = ceil(total/limit)` (0 when total is 0).

**Errors** are always JSON with a **non-empty string under the key `error` or `message`** (either key is accepted; the wording is never checked): `400` invalid input/query/malformed JSON, `404` unknown id or unknown route, `409` duplicate unique. Never a crash, never an HTML page. The evaluator checks the status code exactly and the error body only for "JSON object with a non-empty string under `error` or `message`". The reference server uses `error`.

## 6. Evaluator behaviour

### 6.1 Seed dataset (core/generator.js)
All randomness comes from `mulberry32(seed)`. The seed is a random 32-bit integer per run (`--seed N` reproduces a run) and is stored in the result.

Generate **45 valid records** from the domain config with these guarantees (assert them in a unit test for every domain config, over 200 different seeds):
1. Letters, digits and spaces only in text fields (no punctuation, no accents). text1 length 3..60, text2 length 2..40.
2. Built from word pools, with deliberate overlap: at least one word shared by 4–12 records' text1; at least one word that appears **only in text2** values (never in any text1) in 3+ records; at least one text1 word that appears in 3+ records with different letter case (`Prime`/`PRIME`/`prime`); a **no-match term** `zzqxj` never present anywhere.
3. text1 first letters mix upper and lower case (at least 6 of each) so a case-sensitive sort would differ from a case-insensitive one.
4. Every enum value appears in at least 4 records; the flag is true in at least 10 and false in at least 10.
5. Amounts have `genDecimals` decimals, lie in `[genMin, max]`, include 3 records with an identical amount, and at least 12 distinct values. The integer field spans the config range (include the minimum value at least once; none outside the range).
6. If `uniqueCode` exists: unique values (case-insensitive) matching the length bounds, like `PREFIX-1042`.
7. No leading/trailing spaces in the seed records (a separate padded payload is used for test C03).

Invalid-payload builders: each required field missing; wrong types (amount as string, integer as 1.5, flag as "yes"); amount 0 and -5; text1 of 2 characters; invalid enum value; empty object; malformed JSON text.

### 6.2 Reference model (core/model.js)
The evaluator keeps its own in-memory model of every record it created (with the id the server returned). **Every expected value in a test is computed from the model, never from what the server returned.** Implement `query(params)` that applies the contract in section 5 (filter, search, sort, paginate) and returns `{data, total, totalPages}`. Float comparison uses an absolute tolerance of 1e-9. For text sort checks accept the result if it is non-decreasing under **either** lower-cased code-unit order **or** `localeCompare('en')`. Sorting ties: only check non-decreasing, not tie order.

### 6.3 Preflight, order, statuses
1. **Reachability:** poll `GET /api/<resource>` until it answers (default wait 60 s, `--wait N`). Not reachable → print a clear message and **ABORT** (nothing is scored or submitted).
2. **Empty server:** the list must return `200` with `total == 0`. Otherwise **ABORT** with "Restart your server so it starts with no data". (The paper requires an empty server at the start of every run.)
3. **Order of execution** (state matters): seed phase (tests C01–C05) → read-only groups (R, L, G, F, S, O, X, H01, H02) → mutating groups (U, P, D; each test creates its own scratch record with POST) → negative-create tests (C06–C14) last, because a broken server may store junk from them.
4. Statuses: `PASS`, `FAIL`, `BLOCKED`. Score = number of PASS. **BLOCKED** means the test could not be attempted because something it depends on was broken: if fewer than 40 of the 45 seed POSTs return 2xx with a usable id, mark every test except C01–C14 and H02 as BLOCKED without running it; if a test's own scratch POST fails, that one test is BLOCKED. A BLOCKED test scores 0 but is reported separately so the student sees the root cause (POST) instead of 80 identical failures.
5. Per-request timeout 5 s (a timeout is a test FAIL). Whole run capped at 180 s: tests not yet run count as FAIL with reason `run time limit`.
6. A test never throws out of the runner: wrap each test, record `status` and a `detail` object `{request, expected, actual}`.

### 6.4 The 100 tests (exactly these IDs; the group order is the report order)


### Create (POST) (14 tests)

| ID | Test | Pass condition |
|---|---|---|
| C01 | POST a valid record | 201 Created |
| C02 | Created record has a non-empty id | body.id exists |
| C03 | Response echoes every submitted field | values equal (strings trimmed, numbers equal) |
| C04 | Two creates get different ids | ids differ |
| C05 | Created record can be fetched | GET /:id returns the same field values |
| C06 | Missing required text field | 400 + JSON body with a non-empty string under `error` or `message` |
| C07 | Missing required numeric field | 400 + JSON body with a non-empty string under `error` or `message` |
| C08 | Wrong types | amount as string, count as 1.5, flag as "yes": each must be 400 (all three must pass) |
| C09 | Amount not above 0 | amount 0 -> 400 and amount -5 -> 400 |
| C10 | Text1 shorter than minimum | text1 of 2 chars -> 400 |
| C11 | Invalid enum value | 400 |
| C12 | Empty object body {} | 400 |
| C13 | Malformed JSON body | 400 with a JSON error body (`error` or `message`); never 500 or an HTML page |
| C14 | Uniqueness rule | unique domains: same code in different letter case -> 409. Other domains: identical payload twice -> both 201 with different ids |

### Read one (GET /:id) (8 tests)

| ID | Test | Pass condition |
|---|---|---|
| R01 | GET an existing record | 200 |
| R02 | Body fields equal what was stored | all fields equal |
| R03 | body.id equals the requested id | equal |
| R04 | Unknown numeric id | 404 |
| R05 | 404 body is JSON with an error string | JSON body with a non-empty string under `error` or `message` |
| R06 | Non-id-looking path (/abc-not-an-id) | 404 (not 400 or 500) |
| R07 | Content-Type is JSON | application/json |
| R08 | Five different seeded ids | each returns its own record, not the first one |

### List basics (GET) (8 tests)

| ID | Test | Pass condition |
|---|---|---|
| L01 | GET list | 200 |
| L02 | body.data is an array | array |
| L03 | page, limit, total, totalPages are numbers | all four are numbers |
| L04 | Defaults with no params | page = 1, limit = 10 |
| L05 | Default page size | data.length = min(10, total) |
| L06 | total is correct | equals the number of records the evaluator holds |
| L07 | Every item is well formed | has id and all required fields with correct types |
| L08 | Default order | insertion order (records appear in creation order) |

### Update (PUT) (10 tests)

| ID | Test | Pass condition |
|---|---|---|
| U01 | PUT a valid full record | 200 |
| U02 | Response reflects the new values | fields equal the PUT body |
| U03 | id is unchanged | same id |
| U04 | GET after PUT shows new values | fields equal |
| U05 | PUT missing a required field | 400 |
| U06 | PUT with an invalid value | 400 |
| U07 | PUT on an unknown id | 404 and nothing is created |
| U08 | Other records untouched | 3 spot-checked records unchanged |
| U09 | id inside the body is ignored | stored id stays the path id |
| U10 | Uniqueness on PUT | unique domains: another record's code -> 409. Other domains: PUT with values identical to another record -> 200 |

### Update (PATCH) (10 tests)

| ID | Test | Pass condition |
|---|---|---|
| P01 | PATCH one field | 200 |
| P02 | Only that field changed | all other fields unchanged |
| P03 | PATCH several fields | 200 and all of them changed |
| P04 | PATCH with empty body {} | 400 |
| P05 | PATCH with an invalid enum value | 400 |
| P06 | PATCH with a wrong type | 400 |
| P07 | PATCH on an unknown id | 404 |
| P08 | Unknown fields ignored | not stored and not echoed back |
| P09 | PATCH cannot change id | id stays the same |
| P10 | Uniqueness / persistence | unique domains: another record's code -> 409. Other domains: PATCH flag, then GET shows the toggled value |

### Delete (DELETE) (8 tests)

| ID | Test | Pass condition |
|---|---|---|
| D01 | DELETE an existing record | 204 |
| D02 | 204 response has an empty body | empty |
| D03 | GET after DELETE | 404 |
| D04 | DELETE the same id again | 404 |
| D05 | DELETE an unknown id | 404 |
| D06 | List total after DELETE | decreases by exactly 1 |
| D07 | Other records unaffected | 3 spot-checked records unchanged |
| D08 | Deleted record absent from the full list | id not found when every page is read |

### Pagination (12 tests)

| ID | Test | Pass condition |
|---|---|---|
| G01 | limit=5 | exactly 5 items |
| G02 | page=2&limit=5 | items 6-10 of the expected order |
| G03 | Page 1 and page 2 | no overlapping ids |
| G04 | Last page | contains exactly the remainder |
| G05 | totalPages | = ceil(total / limit) for limit=7 |
| G06 | Walk every page (limit=10) | every record appears exactly once |
| G07 | page beyond the last page | 200 with empty data |
| G08 | page=0 | 400 |
| G09 | page=-1 | 400 |
| G10 | limit=0 | 400 |
| G11 | limit=51 (maximum is 50) | 400 |
| G12 | Non-integers | page=abc -> 400 and limit=1.5 -> 400 |

### Filter (10 tests)

| ID | Test | Pass condition |
|---|---|---|
| F01 | Filter by one enum value | only matching items; count equals expected |
| F02 | Every enum value | each value returns the correct count |
| F03 | flag=true | only matching items; count correct |
| F04 | flag=false | only matching items; count correct |
| F05 | min<Amount> only | all items >= min; count correct |
| F06 | max<Amount> only | all items <= max; count correct |
| F07 | min and max together | inclusive at both boundary values (boundaries are seeded values) |
| F08 | Filter + pagination | total is the filtered total; totalPages correct |
| F09 | Enum + flag combined | AND of both; count correct |
| F10 | Invalid filter values | invalid enum value -> 400 and flag=maybe -> 400 |

### Search (8 tests)

| ID | Test | Pass condition |
|---|---|---|
| S01 | Search a text1 word | every result contains the term in text1 or text2 |
| S02 | Case-insensitive | UPPER and lower case give the same total |
| S03 | Search a text2 word | results match on text2 |
| S04 | Term that matches nothing | 200, data [], total 0, totalPages 0 |
| S05 | total equals the expected count | exact |
| S06 | Search + pagination | totals and pages are consistent |
| S07 | Partial term (first 3 letters) | substring match works |
| S08 | Empty search= value | same result as no search |

### Sort (6 tests)

| ID | Test | Pass condition |
|---|---|---|
| O01 | sort=<amount> ascending | non-decreasing by amount |
| O02 | sort=<amount>&order=desc | non-increasing by amount |
| O03 | sort=<text1> ascending | non-decreasing, compared case-insensitively |
| O04 | sort=<count> ascending | non-decreasing by count |
| O05 | Invalid sort field (sort=banana) | 400 |
| O06 | Invalid order (order=sideways) | 400 |

### Combined queries (4 tests)

| ID | Test | Pass condition |
|---|---|---|
| X01 | Search + filter | count equals expected |
| X02 | Filter + sort + pagination | order, count and pages correct |
| X03 | Search + filter + sort + page together | exact expected page |
| X04 | min greater than max | 200, empty data, total 0, totalPages 0 |

### HTTP basics (2 tests)

| ID | Test | Pass condition |
|---|---|---|
| H01 | JSON responses | list, create and error responses all have Content-Type application/json |
| H02 | Unknown route (/api/nothing) | 404 with a JSON error body (`error` or `message`) |

Implementation notes that remove ambiguity:
- **C03** sends a payload whose text1 has leading and trailing spaces and expects the stored/returned text1 trimmed, all other fields equal.
- **C08** has three sub-checks (amount as string, integer as 1.5, flag as "yes"); pass only if all three return 400.
- **C09** has two sub-checks (amount 0, amount -5); both must be 400.
- **C14** for `uniqueCode` domains: create a record, create another with the same code in different letter case → expect 409. For other domains: POST the identical payload twice → both 201 with different ids.
- **U01** keeps the record's own unique code while changing other fields (tests the "may keep its own value" rule).
- **U07, P07, D05** use an id that cannot exist: `987654321` for numeric servers and also test the string `no-such-id`; both must be 404.
- **U08 / D07** compare 3 seed records, fetched by GET, against the model.
- **D06** reads `total` from the server before and after the delete (limit=1) and expects exactly one less.
- **G11:** `limit=51` must be 400 and `limit=50` must be accepted (200, `min(50,total)` items). Both required.
- **F07:** pick two seeded amounts as `min` and `max` so both boundary values are present; expected count comes from the model.
- **S01/S02/S07:** use words that exist in the generated data; S03 uses the text2-only word; S04 uses `zzqxj`.
- **O03/O04** run `sort=<text1>` and `sort=<count>`; **O05/O06** use `sort=banana`, `order=sideways`.
- **X04:** `min` greater than `max` → 200 with `data: []`, `total: 0`, `totalPages: 0`.
- **H01** checks `Content-Type` contains `application/json` on list, create and an error response.
- Tests must not depend on each other's data except through the model.

### 6.5 Output

**Trainer evaluator** (`trainer-only/trainer-cli.js`, `renderTrainer`): for every failed or blocked test print the ID and name, then what was sent, what was expected and what came back (status and the first 200 characters of the body). Passed tests print one line. End with `Score: 73 / 100  (passed 73, failed 24, blocked 3)`, the group table, the run id and the seed.

**Assessment kit** (`kits/assessment`, `renderStudent`) must **never print or write anywhere a score, a count of passed or failed tests, a test id, a test name, or any per-test result.** Allowed output only:
1. A start line: `Checking your API at <url> ...`.
2. A progress line that shows only how many checks have been **attempted**, for example `Running checks: 37 of 100 attempted` (a counter that increases regardless of result; no colours or ticks that depend on the result).
3. Preflight problems (these are not results; nothing is submitted): `Cannot reach your server at <url>` or `Your server is not empty. Restart it so it starts with no data.`
4. On a successful submission: `Submission recorded. Your result has been sent to your trainer.` and the run id.
5. If the collector cannot be reached: `Your result is saved on this computer but NOT recorded yet. Tell the invigilator, then run npm run submit-pending.`
6. A collector 4xx: print the collector's message (for example `Wrong set for this registration number`).

Rules that make the "no marks" promise real:
- The collector's response to `POST /api/results` is `{ "ok": true }` only. It never returns score, best score or attempts to the kit.
- The `.pending/<runId>.json` queue file must not be readable as plain JSON with test results: store it as base64 of an AES-256-GCM encrypted blob (key derived with sha256 from the collector key in `config.json`). This is a deterrent, state that in a code comment.
- No debug flag, environment variable or log file prints results. There is no `--verbose`.
- Add a unit test that runs the assessment kit CLI against the reference server **and against the `M07` mutant** and asserts that stdout and stderr never match `/PASS|FAIL|BLOCKED|score|passed|failed|\b\d{1,3}\s*\/\s*100\b/i`. The progress counter therefore uses the format `Running checks: 37 of 100 attempted` (it must not match that regex).

### 6.6 CLI

**Trainer** (`trainer-only/trainer-cli.js`): `npm run trainer -- --set A3 [--url http://localhost:8080] [--seed N] [--only C01,C02] [--wait 60] [--reg 22CS001 --save]`
- Works for all 10 sets (reads every file in `domains/`). `--set` is required, there is no automatic assignment here.
- Prints the full trainer output (6.5). `--seed` and `--only` allowed.
- With `--save` it sends the result to the collector as a **trainer run** (`mode: "trainer"`, with the student's registration number given by `--reg`) using HTTP Basic auth with `ADMIN_PASSWORD` read from `collector/.env`. Trainer runs are stored in a separate Atlas collection `trainerRuns` and never change a student's `students` document. Without `--save` nothing is stored.

**Assessment kit** (`kits/assessment`): `npm run evaluate -- [--url ...] [--wait 60]`, `npm run whoami`, `npm run submit-pending`.
- No `--set`, `--seed`, `--only`, `--no-submit` or `--reg` option (the registration number is asked once and saved).
- Default URL `http://localhost:8080`. The kit evaluates the set assigned to the registration number, nothing else.
- First run asks for the registration number (regex `^[A-Za-z0-9._/-]{4,20}$` after trim), upper-cases it and saves it to a git-ignored `.student.json`.
- `npm run whoami` prints the assigned set (for example `Your set is A5`). This is the only place a set is shown.
- **Assessment set assignment (core/assign.js and collector/assign.js, identical):** `n = reg.trim().toUpperCase()`, `v = first 4 bytes of sha256(n) as a big-endian unsigned integer`, `setId = "A" + (v % 8 + 1)`. Unit-test both implementations against these vectors:

| Input | Normalised | uint32 | Set |
|---|---|---|---|
| `'22CS001'` | `22CS001` | 2367001445 | **A6** |
| `'22cs002 '` | `22CS002` | 2418948190 | **A7** |
| `'SIET2026-017'` | `SIET2026-017` | 1008761126 | **A7** |
| `'21IT145'` | `21IT145` | 2488862210 | **A3** |
| `'23EC090'` | `23EC090` | 2012382344 | **A1** |

## 7. Result document and submission

```json
{
  "runId": "uuid-v4",
  "registrationNumber": "22CS001",
  "setId": "A6",
  "mode": "assessment",       // "assessment" from the kit, "trainer" from trainer-cli --save
  "seed": 1234567890,
  "evaluatorVersion": "1.0.0",
  "startedAt": "ISO", "finishedAt": "ISO", "durationMs": 41230,
  "serverUrl": "http://localhost:8080",
  "tests": [ { "id": "C01", "status": "PASS" } ],
  "checksum": "hex"
}
```
`checksum = HMAC-SHA256(COLLECTOR_KEY, reg|setId|mode|seed|sortedPassedIds.join(",")|evaluatorVersion)`.
`POST <COLLECTOR_URL>/api/results` with header `x-collector-key`. The kit reads `collectorUrl` and `collectorKey` from a `config.json` written by `build-kits`.

- If the collector is unreachable or returns 5xx: save the result to the obfuscated `.pending/<runId>` file and print the message from 6.5 item 5. Retry pending results automatically at the start of the next run and on `npm run submit-pending`.
- 4xx responses are final: print the collector's message (6.5 item 6).
- ABORTED runs are never submitted.

## 8. Collector (trainer's laptop) and MongoDB Atlas

`collector/server.js` (Express), configuration from `collector/.env`:
`MONGODB_URI`, `DB_NAME=webdev_assessment`, `COLLECTOR_KEY`, `ADMIN_PASSWORD`, `PORT=4000`. Provide `.env.example` and `npm run check-atlas` (connects, pings, prints the database name or a readable error). Bind to `0.0.0.0` and on start print an unmissable banner with the LAN URL (detect the IP via `os.networkInterfaces()`), exactly like:

```
=================================================
  Students submit to: http://<lan-ip>:4000
  Admin dashboard:    http://<lan-ip>:4000/admin
=================================================
```

**POST /api/results**
1. Require `x-collector-key`; verify the checksum; validate the payload shape strictly (400 on anything unexpected, ids must match `^[CRLUPDGFSOXH][0-9]{2}$`, no duplicates).
2. Student route (`x-collector-key`): accept only `mode: "assessment"`; recompute the assigned set from the registration number and **reject (400) a mismatch**. Trainer route: see below.
3. Idempotent on `runId` (same run twice → 200, stored once). Rate limit: one submission per registration number per 20 seconds (429).
4. Recompute `score`, `passed`, `failed`, `blocked` and per-group scores **on the server** from `tests` (never trust client totals) and insert into `runs`. Then update the student's summary.
5. Respond `{ ok: true }` **only**. Never return the score, best score or attempts to the caller.

**POST /admin/api/trainer-runs** (HTTP Basic auth with `ADMIN_PASSWORD`): accepts a result with `mode: "trainer"` (any of the 10 set ids, any registration number), same validation and server-side recomputation, stores it in `trainerRuns`, and **does not touch `runs` or `students`**. This route may return the score (it is for the trainer).

**GET /api/health** → `{ok:true}` (no auth).

**Atlas collections** (create indexes on startup):
- `runs`: one document per run `{ runId, registrationNumber, setId, mode, seed, evaluatorVersion, startedAt, finishedAt, durationMs, serverUrl, score, passed, failed, blocked, groupScores:{create,readOne,...}, tests:[{id,status}], clientIp, receivedAt }`. Indexes: unique `runId`; `{registrationNumber:1, mode:1, receivedAt:-1}`; `{setId:1, score:-1}`.
- `students`: one document per registration number `{ _id: registrationNumber, assignedSet, assessment:{best,latest,attempts,bestRunId,lastRunAt,bestGroupScores}, updatedAt }`. Rebuild the document from `runs` with an aggregation after each insert (simple and robust at this scale).
- `trainerRuns`: same fields as `runs` plus `registrationNumber` (may be empty) and `note`. Index `{registrationNumber:1, receivedAt:-1}`.
- `roster`: `{ _id: registrationNumber, name?, section? }` (optional, uploaded by the trainer).

**Admin dashboard** (`/admin`, HTTP Basic auth with `ADMIN_PASSWORD`; plain HTML + JS, no build step):
- Assessment table: registration number, assigned set, best, latest, attempts, last run time; sortable columns; search box; click a row to see every run and its per-group scores, plus any **trainer re-runs** for that student next to the student's own score (so a suspicious difference is obvious).
- "Trainer runs" tab: every `trainerRuns` document (registration number, set, score, time, note).
- "Not started" list (roster minus students with an assessment run) when a roster exists. `POST /admin/api/roster` accepts a CSV (`reg,name,section`). The dashboard is where the trainer sees marks; students never do.
- Summary strip: students started, average best score, how many scored 100, score distribution.
- Buttons: **Export CSV** (one row per student: registration number, assigned set, best, latest, attempts, per-group best scores, last run) which opens in Excel; delete a single run or a whole student (to clean test data).
- Auto-refresh every 10 seconds.

Collector tests (`node:test` + `mongodb-memory-server`): accepts a valid result and responds `{ok:true}` with no score, rejects a bad key, bad checksum, wrong set, `mode: "practice"` and `mode: "trainer"` on the student route, duplicate `runId` is idempotent, summary updates best/latest/attempts correctly, rate limit works, trainer route stores in `trainerRuns` without changing `students`, CSV export columns.

## 9. Kits and build script

`npm run build-kits` produces **`dist/assessment-kit.zip` only** (sets A1–A8). There is no practice kit. The zip contains `core/` (without any code that renders per-test results, so `renderTrainer` lives only in `trainer-only/`), the kit's `cli.js`, `sets.json` (A1–A8 configs), `package.json` (scripts only, no dependencies), `config.json` (collector URL + key, read from `collector/.env` and the env var `PUBLIC_COLLECTOR_URL`; fail with a clear message if missing), `.gitignore`, and a one-page student `README.md`.

The build must **fail** if any file in the zip contains the text `mongodb`, `MONGODB_URI`, `ADMIN_PASSWORD`, `trainer-only`, `reference`, `renderTrainer`, `P1.json` or `P2.json`, or if the zip contains any `domains/P*.json`. Print the file list at the end.

## 10. Student README (inside each kit)

Short and plain: what the evaluator is, `node --version` must be 18 or higher, start your server with **no data**, run `npm run evaluate`, the server must be restarted before every run, the evaluator **does not show marks or test results** and prints only a success message, what to do if the result is not recorded (`submit-pending`). Do not describe test internals.

## 11. Unit tests (`npm test`)

Generator invariants over 200 seeds for every config in `domains/`; model `query()` against hand-written cases; assignment vectors from section 6.6; checksum round-trip; runner marks BLOCKED correctly; ABORT on non-empty server and on unreachable server; the "no marks shown" test from section 6.5 (assessment kit stdout/stderr never reveals results, and no file in the kit folder after a run contains a readable score); the pending queue file is not plain JSON.

## 12. Reference server and mutants (trainer-only)

`trainer-only/reference/server.js` is a correct Express implementation of section 5, parameterised by `SET_ID` (reads `domains/<SET_ID>.json`) and `PORT`. **Write it from section 5 only. It must not import anything from `core/`**, so a misreading in the evaluator cannot hide in a shared bug. Keep data in memory, never use a file or database.

The same file supports **mutants**: set `MUTANT=<ID>` to switch on exactly one deliberate bug. Implement all of these:

| ID | Name | What it breaks | Tests that must FAIL |
|---|---|---|---|
| M01 | `no-validation` | POST, PUT and PATCH skip all validation | C06 C07 C08 C09 C10 C11 C12 U05 U06 P05 P06 |
| M02 | `create-returns-200` | POST returns 200 instead of 201 | C01 |
| M03 | `put-creates-missing` | PUT on an unknown id creates the record | U07 |
| M04 | `patch-is-put` | PATCH replaces the record, dropping fields that were not sent | P02 |
| M05 | `delete-returns-200-json` | DELETE returns 200 with a JSON body | D01 D02 |
| M06 | `delete-is-soft` | DELETE returns 204 but the record is still returned by GET | D03 D06 D08 |
| M07 | `page-offset-bug` | list offset is page*limit instead of (page-1)*limit | G02 G06 |
| M08 | `no-max-limit` | limit above 50 is accepted | G11 |
| M09 | `search-case-sensitive` | search is case-sensitive | S02 |
| M10 | `search-first-field-only` | search ignores the second text field | S03 |
| M11 | `range-exclusive` | min/max range bounds are exclusive | F07 |
| M12 | `sort-amount-as-string` | amount is sorted as text | O01 O02 |
| M13 | `sort-case-sensitive` | text sort is case-sensitive (uppercase before lowercase) | O03 |
| M14 | `total-is-page-length` | total equals the number of items on the page | L06 G05 |
| M15 | `default-limit-20` | default limit is 20 | L04 L05 |
| M16 | `bad-json-crashes` | malformed JSON returns 500 or an HTML error page | C13 |
| M17 | `html-404` | unknown route and unknown id return an HTML 404 page | H02 R05 |
| M18 | `no-trim` | strings are stored without trimming | C03 |
| M19 | `stores-unknown-fields` | unknown body fields are stored and returned | P08 |
| M20 | `id-mutable` | an id inside a PUT/PATCH body overwrites the record id | U09 P09 |
| M21 | `unique-case-sensitive` | unique code compared case-sensitively | C14 U10 P10 |
| M22 | `no-uniqueness` | duplicate unique codes are accepted | C14 U10 P10 |
| M23 | `wrongly-unique-text1` | 409 returned when text1 duplicates another record | C14 |
| M24 | `patch-empty-ok` | PATCH with an empty body returns 200 | P04 |
| M25 | `boolean-as-string` | the flag accepts the strings "true"/"yes" | C08 |
| M26 | `page-zero-ok` | page=0 and page=-1 are treated as page 1 | G08 G09 |
| M27 | `flag-false-ignored` | flag=false is treated as no filter | F04 |
| M28 | `total-pages-floor` | totalPages uses floor instead of ceil | G05 |
| M29 | `sort-ignores-order` | order=desc is ignored | O02 |
| M30 | `combined-or` | search and filters are combined with OR | X01 X03 |
| M31 | `default-order-reversed` | default list order is newest first | L08 |

`trainer-only/verify.js` (`npm run verify -- --set P1`):
1. Start the reference with no mutant on a free port and run the evaluator (through the same engine the trainer CLI uses, with full results) **three times with three different seeds** (restarting the reference each time): every run must be **100/100 with zero BLOCKED**.
2. For every mutant that applies to the set (the unique-code mutants only apply to sets with `uniqueCode`, `M23` only to sets without), start the reference with that mutant, run the evaluator once, and assert that **every test listed in its "must FAIL" column has status FAIL** and the score is below 100. The mutant must never cause an ABORT, a hang or an evaluator crash.
3. Check that the evaluator ABORTs (not scores) when the server is not empty and when nothing is listening.
4. Print a matrix (mutant × tests that failed) and exit non-zero on any violation.

`trainer-only/find-reg.js` (`npm run find-reg -- --set A3`) prints a registration number that the assignment rule maps to that set (try `TEST-0001`, `TEST-0002`, … until one matches), so the trainer can test an assessment run end to end.

## 13. Self-check before you finish

- [ ] `npm test` passes.
- [ ] With the P1 config: `npm run verify -- --set P1` passes (reference 100/100 on 3 seeds, all applicable mutants caught).
- [ ] Collector starts with a real Atlas URI (`npm run check-atlas` prints OK) — if no Atlas URI is available while you work, say so and test with `mongodb-memory-server` only.
- [ ] A full run of the assessment kit against the reference stores one `runs` document and one `students` document and shows up on `/admin`; the kit printed only the success message (no score anywhere); CSV export opens correctly.
- [ ] `npm run trainer -- --set P1 --url ...` prints the full detail, and `--save` stores a `trainerRuns` document without changing `students`.
- [ ] `npm run build-kits` produces `assessment-kit.zip` and the secrets scan passes.
- [ ] Unzipping `assessment-kit.zip` into a fresh folder and running `npm run whoami` and `npm run evaluate` works with **no `npm install`**.
- [ ] No file inside the kit mentions Atlas, the admin password, the reference server, or practice sets.

## 14. In your final summary

List what you built, what you verified by running it, anything you could not verify (for example, a real Atlas connection or a Spring Boot student project), and repeat the honesty note from section 1.
