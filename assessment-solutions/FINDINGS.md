# Solution projects: findings

Date: 2026-10-10. 20 solution projects (10 sets × Express + Spring Boot) were written from the question papers in
`papers/` and run against the platform evaluator (`npm run trainer`, seeds 1, 2 and 3) and the assessment kit.

**Environment:** Node v22.17.1, Java 24.0.2 (projects target Java 17), Maven 3.9.9 (downloaded to a temp folder; Maven is
not installed on this machine), Spring Boot 3.4.3. pandoc is not installed, so the papers were converted to Markdown
with a small Python script that reads the `.docx` XML. The headings, tables, lists and code samples all came through.

**How the solutions were written:** P1 (Express, then Spring Boot) and P2 (both stacks) were written by hand from the
papers only. A1–A8 were then produced from my own P1 code (sets with no unique field: A3, A4, A6, A8) or P2 code
(sets with a unique field: A1, A2, A5, A7). A token-by-token rewrite swapped in each paper's resource, field names,
ranges, enum values, query names, sort fields and unique field, and I reviewed the output for leftovers. Every project is
self-contained, with its domain written directly into the code. No project imports anything from `assessment-platform`,
none has a config file or generic engine, and none read the platform's domains, core, trainer-only or prompts while being
written. (Section 2 lists the only platform code I read, after every solution was finished.)

---

## 1. Results

Scores are from `npm run trainer -- --set <SET> --url http://localhost:8080 --seed N`, with a freshly started, empty
server for each run. Full output is in `results/<stack>_<SET>_seed<N>.txt`. Start-up time is from launch to the first
HTTP answer, measured by polling every 0.1 s. Spring Boot times are for `java -jar` on the packaged jar.

| Set | Stack | Seed 1 | Seed 2 | Seed 3 | BLOCKED | Kit end-to-end | Start-up | Status |
|---|---|---|---|---|---|---|---|---|
| P1 | Express | 100 | 100 | 100 | 0 | n/a (practice) | 0.14 s | OK |
| P1 | Spring Boot | 100 | 100 | 100 | 0 | n/a (practice) | 0.86 s | OK |
| P2 | Express | 100 | 100 | 100 | 0 | n/a (practice) | 0.14 s | OK |
| P2 | Spring Boot | 100 | 100 | 100 | 0 | n/a (practice) | 0.86 s | OK |
| A1 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A1 | Spring Boot | 100 | 100 | 100 | 0 | not run (kit run once per set, with Express) | 0.85 s | OK |
| A2 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A2 | Spring Boot | 100 | 100 | 100 | 0 | not run (see A1) | 0.86 s | OK |
| A3 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A3 | Spring Boot | 100 | 100 | 100 | 0 | not run (see A1) | 0.86 s | OK |
| A4 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A4 | Spring Boot | 100 | 100 | 100 | 0 | not run (see A1) | 0.86 s | OK |
| A5 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A5 | Spring Boot | 100 | 100 | 100 | 0 | not run (see A1) | 0.86 s | OK |
| A6 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A6 | Spring Boot | 100 | 100 | 100 | 0 | not run (see A1) | 0.86 s | OK |
| A7 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A7 | Spring Boot | 100 | 100 | 100 | 0 | not run (see A1) | 0.86 s | OK |
| A8 | Express | 100 | 100 | 100 | 0 | OK: no score shown, collector stored 100 | 0.14 s | OK |
| A8 | Spring Boot | 100 | 100 | 100 | 0 | not run (see A1) | 0.86 s | OK |

60 trainer runs: all 100/100, 0 failed, 0 BLOCKED, 0 ABORTED.

**Assessment kit end-to-end (A1–A8):**
- I copied `dist/assessment-kit` to a temp folder, unchanged except for `config.json`, which I pointed at a local collector.
- The collector (`collector/server.js`) ran against a throwaway local `mongod` (Homebrew mongodb-community 7.0), with a
  test `COLLECTOR_KEY` and `DB_NAME=e2e_solutions` passed as environment variables. **Atlas was not used**, so the
  real database got no test runs.
- Registration numbers came from `npm run find-reg`: A1 TEST-0003, A2 TEST-0010, A3 TEST-0009, A4 TEST-0001,
  A5 TEST-0014, A6 TEST-0004, A7 TEST-0002, A8 TEST-0016.
- Every kit run printed only `Checking your API…`, the progress lines `Running checks: N of 100 attempted`,
  `Submission recorded. Your result has been sent to your trainer.` and a run id. No marks were shown (`results/kit_<SET>_express.txt`).
- In the collector's `runs` collection, all 8 stored scores were 100 (passed 100, failed 0, blocked 0), equal to the
  trainer runs (`results/kit_collector_scores.txt`).

**Self-made smoke checklist:** before each evaluator run, every project also passed my own checklist of 69–77
requests. It is built from section 9 of the practice papers and the "rules that are easy to miss", and lives outside
this folder because it is not part of any solution.

**Re-run after a fix:** while probing edge cases I found a bug in my **Spring Boot** solutions. `?page=99999999999`
overflowed `Integer.parseInt` and returned 400, but the paper says a page past the end is 200 with empty data. I
fixed all 10 Spring projects (the page is now parsed as a `long`), rebuilt them and re-ran all 30 Spring trainer runs.
The Spring result files in `results/` and the table above come from that re-run. The evaluator did not notice the bug,
because no test sends a huge page number.

---

## 2. Platform findings

No case was found where the evaluator expected something the paper contradicts, and no expected value was wrong in 68
runs (60 trainer + 8 kit). The findings below are **coverage gaps and output details**. I did not change the platform.

To get evidence for PF-1 and PF-2, I read `core/tests/create.js`, `update.js` and `patch.js` **after** all 20 solutions
were finished and frozen.

### PF-1 (important): a boolean sent as the string `"true"` is never tested

- **Paper sentence (every set):** "booleans must be JSON booleans ("true" as text is invalid)" and "So is inStock sent
  as "true"" (`isActive`, `available`, `published` and so on in the other sets).
- **Evidence:** C08 "Wrong types" sends `<flag>: "yes"` (`core/tests/create.js:99`). P06 sends only `<amount>: "abc"`.
  No test sends `"true"` or `"false"`.
- **Reproduced:** `express/A1_employees_naive` with `MISTAKES=9` accepts `"isActive": "true"`. On a manual POST the
  server stores `true` and returns 201, yet it scores **100/100 on seeds 1–8** (output for seeds 1–3 is saved in `results/naive_A1_mistakes-9*.txt`; seeds 4–8
  were run but not saved).
- **Why it matters most for Spring Boot:** I checked Jackson 2.18.2 (Spring Boot 3.4.3 default) on a typed class. It
  **rejects** `"yes"` for a `Boolean`, so C08's boolean case returns 400 for free. It **accepts** `"true"` → `true`,
  `1` → `true`, `12345` → `"12345"` for a String, `"3"` → `3` for an Integer, and `"150"` → `150.0`. A Spring student
  who binds the body straight to a class therefore passes the boolean part of C08 without doing anything. They lose C08
  only because of `"150"` and `1.5`, which the same test catches.
- **Suggestion:** add `[<flag> sent as "true"]` to C08 (or a separate test), and use `<flag>: "false"` in a PATCH test.

### PF-2: paper rules that no test checks

These rules are written in every paper but no test sends them (checked against C01–C14, U01–U10, P01–P10):
- a field set to `null`;
- text that is blank after trimming (`"   "`);
- text longer than its maximum (60 / 40 / 20);
- the second text field shorter than 2;
- the unique field's length (4–20) or type;
- a number sent where text is expected (`"name": 12345`, which Jackson accepts as `"12345"`, see PF-1);
- an amount above its maximum;
- an integer below its minimum or above its maximum;
- a body that is JSON but not an object (`[]`, `"x"`, `null`).

U06 and P05 test only the enum.

A solution can ignore any of these and still score 100. You may decide this is fine, since 100 tests cannot cover
everything, but students are told these rules are checked ("rejects … out-of-range numbers, short text…" in the marking
scheme). The ones most worth adding are blank text, a number above its maximum, and the integer range.

### PF-3 (minor, output detail): L06 hides the actual total

With `MISTAKES=4` (total = page size), L06 prints `expected: total = 46` but `got:` shows only the start of the body,
cut off before `total` (`results/naive_A1_mistakes-4.txt`). S03 already prints `got: total 0 | …`, and L06 should too.

### PF-4 (minor, output detail): C13 prints a whole HTML page

With `MISTAKES=1`, C13's `got:` dumps the multi-line Express HTML error page into the report
(`results/naive_A1_mistakes-1.txt`). Suggestion: show it on one line and truncate it, for example `400 text/html <!DOCTYPE html>…`.

### PF-5 (security, not the evaluator): a real-looking Atlas credential is committed

`assessment-platform/collector/.env.example` is tracked in git (commit `02b6694`). It contains a full
`mongodb+srv://<user>:<password>@cluster0.….mongodb.net/…` connection string, not a placeholder. If it is a real
database user, rotate that password in Atlas and put a placeholder in `.env.example`. I did not change the file.

---

## 3. Paper findings

All findings apply to **all 10 papers** unless a set is named. "Current" quotes the paper; "Proposed" is the sentence to
add or change. My solutions implement the proposed reading.

| # | Section | Current wording | Problem | Proposed wording |
|---|---|---|---|---|
| Q1 | §3, unique field row (P2, A1, A2, A5, A7) | "4 to 20 characters. Unique across all records, ignoring letter case." | Unlike the text fields, it does not say "Trimmed", so it is unclear whether `"  EMP-1042  "` is trimmed, and whether it is a duplicate of `EMP-1042`. | "Trimmed; 4 to 20 characters. Unique across all records, ignoring letter case (compared after trimming)." |
| Q2 | §5 `sort` | "Text is compared ignoring letter case." | The order of records with equal values is not defined, nor whether `desc` reverses that order. | Add: "Records with equal values keep their creation order, in both asc and desc." |
| Q3 | §5 `order` | "asc (default) or desc. Anything else is 400." | Does `?order=desc` without `sort` reverse creation order? | Add: "order is used only with sort. Without sort, order is still validated but records stay in creation order." |
| Q4 | §5, all parameters except search | e.g. "Positive integer. Default 1. Anything else is 400." | Only `search` says what an empty value means. Is `?page=`, `?minPrice=` or `?category=` "not given" or invalid? (In JavaScript, `Number("")` is `0`, so a naive check accepts `minPrice=` as 0.) | Add under the table: "An empty value for any parameter other than search is invalid (400)." |
| Q5 | §5 `search` | "Empty value means no search." | It doesn't say whether `?search=%20%20` (only spaces) means no search, or whether the term is trimmed. | "Empty value, or a value of only spaces, means no search. Otherwise the text is matched as typed." |
| Q6 | §5 `sort` | "Text is compared ignoring letter case." | The order of non-letters (space, `-`, digits) is not defined. JavaScript `localeCompare` and a plain lower-case comparison can differ. | Add: "Compare the lower-case texts character by character (JavaScript: `a.toLowerCase() < b.toLowerCase()`; Java: `compareToIgnoreCase`)." |
| Q7 | §3 integer row / §6 Validation | "integers must be whole numbers" | Is `3.0` a whole number? JavaScript can't tell `3.0` from `3`, but Jackson parses `3.0` as a `Double`. Express and Spring students can disagree. | Add: "A whole number written with a decimal point, such as 3.0, counts as a whole number." |
| Q8 | §6 table | "Unknown id, or unknown route: 404" | A method a path doesn't support (`DELETE /api/products`, `POST /api/products/5`) is 404 in Express but **405** by default in Spring Boot. | Add: "A method a path does not support (for example DELETE /api/products) is an unknown route: 404." |
| Q9 | §6 table | "Invalid body, invalid field, malformed JSON…: 400" | A body sent without `Content-Type: application/json` (or with none at all) gives **415** by default in Spring Boot. | Add: "A missing body, or a body not sent as application/json, is 400." |
| Q10 | §6 Validation | (not mentioned) | A body that is valid JSON but not an object (`[]`, `"text"`, `null`) is not covered. | Add: "The body must be a JSON object. Anything else (an array, a string, null) is 400." |
| Q11 | §4 PATCH | "PATCH needs at least one recognised field (an empty body {} is 400)." | Clear, but students often miss that `{"id": 5}` or `{"color": "red"}` also has no recognised field. | Add: "({"id": 5} or a body with only unknown fields is also 400)." |
| Q12 | §4 / §6 | (not mentioned) | Precedence when several errors apply: PUT on an unknown id with an invalid body (404 or 400?), or an invalid body that also duplicates the unique field (400 or 409?). | Add: "Checks run in this order: unknown id (404), then invalid body (400), then duplicate (409)." |
| Q13 | §5 `page` | "A page past the last one returns 200 with empty data." | Correct, but a huge page (`page=99999999999`) overflows `Integer.parseInt` in Java. My own Spring solution got this wrong at first. | Add a note for Java: "page can be larger than an int: parse it as a long." |
| Q14 | §4 | (not mentioned) | Trailing slash: `/api/products/` works in Express (non-strict routing) but is 404 in Spring Boot 3. Repeated parameters (`?page=1&page=2`) are also not covered. | Low priority. Either say "paths have no trailing slash", or leave it untested (it currently is untested). |
| Q15 | §1 (A1, A3, A8) | "Build a REST API for a Employee Directory / a Online Courses / a Event Tickets resource" | Grammar. | "for an Employee Directory / an Online Courses / an Event Tickets resource" |

None of these caused a lost mark against the current evaluator. They are places where I had to guess and a student will
too, and the evaluator could start checking them later.

---

## 4. Spring Boot notes

| Issue | What happens by default | What my solutions do | Does the paper warn? |
|---|---|---|---|
| Jackson coercion | On a typed class: `"150"` → 150, `1.5` → 1 (truncated), `"3"` → 3, `"true"` / `1` → true, `12345` → `"12345"`. Checked with Jackson 2.18.2. | `@RequestBody Object` (a `Map`) and a type check per field (`instanceof String / Number / Boolean`, whole-number check for integers). | **No.** The papers say what is invalid but not that Spring accepts it silently. Suggest one line: "Spring Boot: Jackson converts "12" to 12 and "true" to true. Read the body as a Map and check the types yourself." |
| Malformed JSON | `HttpMessageNotReadableException`. The default `/error` JSON has `"error": "Bad Request"`, so it passes, but a student with a custom handler can easily return HTML or 500. | `@RestControllerAdvice` turns it into a 400 JSON body. | Partly ("never… an HTML error page"). |
| Unknown route | Spring Boot 3.2+ throws `NoResourceFoundException`. The default answer is a JSON 404 for API clients. | `spring.web.resources.add-mappings=false` plus handlers for `NoHandlerFoundException` and `NoResourceFoundException`. | Yes (404 JSON). |
| Unsupported method | 405 | 404 JSON (paper Q8) | No |
| Wrong or missing Content-Type | 415 | 400 JSON (paper Q9) | No |
| Bad query value (`page=abc`) | With `@RequestParam int page`, a `MethodArgumentTypeMismatchException` gives 400 with Spring's default body. A `double minPrice` accepts `NaN`, `Infinity` and `1d`. | Every query parameter is read as a `String` (`MultiValueMap`) and parsed by hand with a strict number pattern. | No |
| Huge page | `Integer.parseInt("99999999999")` throws, so the student returns 400 or 500. | Parsed as a `long` (paper Q13). | No |
| `3.0` for an integer | A typed `Integer` truncates; a `Map` gives a `Double`. | A `Double` with no fraction counts as whole, the same as JavaScript (paper Q7). | No |
| Trailing tokens (`{…} xyz`) | Jackson ignores them and accepts the body. | `spring.jackson.deserialization.fail-on-trailing-tokens=true` | No (low priority) |
| DELETE body | — | `ResponseEntity.noContent().build()` | Yes (204 empty) |
| Port | — | `server.port=${PORT:8080}` | Yes |

The only behaviour where my Express and Spring solutions answer differently is the trailing slash (Express 200,
Spring 404). The evaluator does not test it.

---

## 5. Typical-student check (A1 Express)

`express/A1_employees_naive` is a copy of the A1 solution with the ten mistakes, each switched on by
`MISTAKES=<n>` (default `all`). With all ten on at once, a bare-array list (mistake 8) hides mistakes 4–7, so I
also ran each mistake **alone** (seed 1). Output is in `results/naive_A1_mistakes-<n>.txt`.

| # | Mistake | Score (alone) | Caught by | Detail shown (sent / expected / got) |
|---|---|---|---|---|
| 1 | Malformed JSON returns an HTML page | 99 | C13 | Yes. `got: 400 <!DOCTYPE html>…` (see PF-4) |
| 2 | `PUT` creates a missing record | 99 | U07 | Yes. `expected: 404 (PUT never creates)`, `got: 201 {…}` |
| 3 | DELETE returns 200 with a body | 98 | D01, D02 | Yes. `expected: 204 No Content`, `got: 200 {"message":"Deleted",…}` |
| 4 | `total` is the page size | 91 | L06, D06, G05, F02, F08, S06, S08, X02, X03 | Yes, but L06 doesn't print the actual total (PF-3) |
| 5 | `page=0` accepted | 99 | G08 | Yes. `expected: 400`, `got: 200 {…}` |
| 6 | Numbers sorted as text | 96 | O01, O02, O04, X02 | Yes. Prints the received order: `values: [1.24,10.24,10000000,1405.25,…]` |
| 7 | Case-sensitive search | 93 | S02, S03, S05, S06, S07, X01, X03 | Yes. `expected: total 5 for search=PRIME`… |
| 8 | List returns a bare array | 57 | L02–L08, U07, D06, D08, G01–G07, G11, F01–F09, S01–S08, O01–O04, X01–X04 (43 tests) | Yes. `expected: 200 with "data" as an array`, `got: 200 [{…}]` |
| 9 | `"true"` string accepted for a boolean | **100** | **none** (seeds 1–8) | **Not caught (PF-1)** |
| 10 | Id `abc` returns 400 | 96 | R06, U07, P07, D05 | Yes. `expected: 404 (not 400 or 500)`, `got: 400 {…}` |
| all | All ten together | 50 | 50 tests | — |

9 of 10 mistakes are caught by the tests I expected, with useful detail. Mistake 9 is not caught.

---

## 6. What I could not verify

- **Atlas:** not used on purpose. The kit end-to-end runs used a local MongoDB, so writing to the real Atlas
  `webdev_assessment` database is untested here. `npm run check-atlas` was not run.
- **Kit with Spring Boot:** the kit was run once per assessment set, with the Express solution. Spring Boot solutions
  were checked with the trainer only, which runs the same tests.
- **Kit on a second machine / over WiFi:** the collector ran on `127.0.0.1`, and the LAN URL in the real
  `dist/assessment-kit/config.json` (`http://192.168.0.3:4000`) was not exercised.
- **Maven project from a clean machine:** dependencies came from Maven Central and `~/.m2`. `mvn spring-boot:run`
  was not tried; I ran the packaged jar instead.
- **Seeds beyond 3:** only for the naive mistake 9 (seeds 1–8). All solutions were run on seeds 1–3, as the task asks.
