# Claude Code Prompt — Build solution projects for all 10 sets and test the platform with them

Run this in Claude Code **after** the platform is built (Prompt 00 and all ten set prompts finished, `npm test` and `npm run verify` passing). Run it in a **new folder next to** `assessment-platform/`, for example `assessment-solutions/`. Put the ten question papers in `assessment-solutions/papers/` first (the `.docx` files from `Assessment_Question_Papers.zip`).

---

## 1. Goal

Write **20 solution projects**: for each of the 10 sets (P1, P2, A1–A8), one **Express (Node.js)** project and one **Spring Boot (Maven)** project, exactly the way a good student would write them from the question paper. Then run the platform's evaluator against every one of them.

This has three purposes, in this order of importance:
1. **Test the evaluator with real, independently written servers.** The platform's own reference server was written by the same process that wrote the tests, so it can share the same misreadings. These solutions are the independent check.
2. **Test the question papers.** Every time you have to guess what the paper means, that is a problem students will also face. Record it.
3. **Give the trainer a working answer key** for every set, in both stacks.

## 2. Independence rules (these matter more than anything else)

1. **Build each solution from the question paper only.** Convert it first: `pandoc papers/<SET>_*.docx -t markdown -o /tmp/<SET>.md` and read that. Do **not** read `assessment-platform/domains/*.json`, `assessment-platform/core/`, `assessment-platform/trainer-only/` or any prompt file while writing a solution. Do not copy code from the reference server.
2. **No shared code between solutions or with the platform.** Each project is self-contained and hard-codes its own domain: resource name, field names, ranges, enum values, unique field, sort fields. No config files, no generic "engine", no reflection over a schema. A student writes this directly, and so do you.
3. **Write it the way a good student would**, not as a framework: simple, readable, one file for Express (`server.js`, a second file for helpers is fine) and a small standard Spring Boot layout (controller, model class or map-based handling, one exception handler). Comments are welcome.
4. **No database, no file I/O, no seed data.** Records live in an array or list in memory. The server starts empty.
5. Read the port from `PORT` and default to **8080**.
6. Dependencies: Express projects use only `express`. Spring Boot projects use only **Spring Web** (no Lombok, no Validation starter needed; you may use them if you like but the project must also work without extras). Java 17 or newer, Maven.

## 3. Folder layout

```
assessment-solutions/
  papers/                          # the 10 .docx papers (given)
  express/<SET>_<slug>/            # package.json, server.js, README.md
  springboot/<SET>_<slug>/         # pom.xml, src/main/java/..., src/main/resources/application.properties, README.md
  results/                         # run outputs (section 6)
  FINDINGS.md                      # the final report (section 7)
```

`<slug>` is the resource, for example `express/A3_courses`, `springboot/A3_courses`. Each README says in three lines how to run the project and on which port.

## 4. What every solution must handle (known pitfalls)

These are real traps. A careful student solves them; the evaluator checks them. Implement them properly rather than by special-casing the tests.

**Both stacks**
- Strict validation of the **raw JSON**: a string where a number is expected, a number where a string is expected, `"true"` where a boolean is expected, a non-integer where an integer is expected, a missing field, `null`, text that is blank after trimming, text outside its length range, a number outside its range, an enum value that does not match exactly. All `400`.
- Strings are **trimmed** before validation and before storing.
- Unknown fields in the body are ignored (not stored, not returned). `id` in a body is ignored.
- `PUT` needs every required field and never creates. `PATCH` needs at least one recognised field (`{}` is `400`), validates only the fields sent, and leaves the rest unchanged.
- An id that does not exist is `404`, whatever it looks like (`987654`, `abc`, `no-such-id`).
- `DELETE` returns `204` with **no body**.
- Malformed JSON body: `400` with a JSON error body (`error` or `message`), never a stack trace or an HTML page; the server keeps running.
- Unknown route: `404` with a JSON body.
- Every error response is JSON with a non-empty `error` string.
- List: `page`, `limit` (max 50), `search`, the filters, `sort`, `order`, with the validation in the paper (`400` for anything invalid, `200` with empty `data` for a page past the end, `200` with empty `data` when min is greater than max). Processing order: filter, search, sort, paginate. `totalPages` is `ceil(total/limit)` and `0` when `total` is `0`. Default order is creation order. Text sort ignores letter case; numbers sort as numbers.
- Unique field (when the set has one): compare ignoring letter case, `409` on create, `PUT` and `PATCH` when another record has it; a record may keep its own value.

**Express-specific**
- `express.json()` returns an HTML error page on malformed JSON by default: add an error-handling middleware that returns JSON.
- Register the list route and the `/:id` route correctly, and add a final `404` handler returning JSON.

**Spring Boot-specific**
- Jackson silently **coerces** `"12"` to a number, `1.5` to an integer (truncating) and `"true"` to a boolean. Do not bind the body straight to a typed class and trust it. Accept the body as `Map<String,Object>` (or `JsonNode`) and validate types yourself.
- Handle `HttpMessageNotReadableException` and every other exception with a `@RestControllerAdvice` that returns JSON, and make unknown routes return a JSON `404` (for example by throwing on no handler and handling it, or by a custom error controller).
- A bad query value (`page=abc`) must return `400`, not Spring's default conversion error page: take query parameters as `String` and parse them yourself.
- Return `204` with no body for delete (`ResponseEntity.noContent()`).
- Configure `server.port=${PORT:8080}`.

If a pitfall is not covered by the paper, that is a **paper finding**: log it (section 7) and still implement the sensible behaviour.

## 5. Order of work

1. Do **P1 Express** first. Run it, test it by hand with `curl` against the paper's checklist (section 9 of a practice paper) and every example in section 7 of the paper.
2. Then **P1 Spring Boot**.
3. Then the remaining sets, one at a time, **both stacks per set**, running each as soon as it is written. Reuse your own knowledge from the previous project, but write each project out in full with its own field names.
4. Do not write all 20 and test at the end.

## 6. Testing against the platform

For each solution (start it **empty** on port 8080, stop it afterwards):

1. `cd ../assessment-platform && npm run trainer -- --set <SET> --url http://localhost:8080 --seed 1` then with seeds `2` and `3`, restarting the solution between runs. Save the full output of each run to `results/<stack>_<SET>_seed<N>.txt`.
2. For assessment sets also run the **assessment kit** once end to end (collector with `mongodb-memory-server` or the real Atlas URI if it is configured, a registration number from `npm run find-reg -- --set <SET>`, then `npm run evaluate` from the unzipped kit). Confirm the kit prints only the success message and the collector stored a score equal to the trainer run's score.
3. **Expected result: 100 / 100 on all three seeds, zero BLOCKED.**

### If a run is below 100

For each failed test, decide **which side is wrong** and say how you decided:
- **Your solution** does not follow the paper: fix the solution.
- **The paper** is ambiguous or silent: fix the solution to the most sensible reading, and log a paper finding with the exact sentence to add or change.
- **The evaluator** expects something the paper does not say, or has a bug (for example a wrong expected value): **do not change the platform in this task.** Log it with the evidence: the test id, the request, the response, the paper sentence. The trainer will decide.

Never edit a test, a domain config or the reference server to make a solution pass.

### Typical-student check (small, optional but useful)

For **A1 Express only**, make a copy `express/A1_employees_naive/` containing the ten most common student mistakes (from the list below), run the trainer evaluator on it, and confirm each mistake is caught by the test(s) you expect and the output shows a useful sent / expected / actual detail:
1. a malformed JSON body crashes or returns HTML;
2. `PUT` creates a missing record;
3. delete returns `200` with a body;
4. `total` is the page size;
5. `page=0` is accepted;
6. numbers sorted as text;
7. search is case-sensitive;
8. the list returns a bare array;
9. a `"true"` string is accepted for a boolean;
10. an id of `abc` returns `400`.

## 7. Final report: `FINDINGS.md`

1. **Results table:** one row per solution: set, stack, seed 1 / 2 / 3 score, BLOCKED count, assessment-kit end-to-end result (assessment sets), start-up time, and status (OK / needs attention).
2. **Platform findings:** every case where the evaluator looked wrong, with test id, request, response, paper sentence, and your reasoning. Empty is a good answer, but only if you ran everything.
3. **Paper findings:** every ambiguity or gap you hit while writing the solutions, with the paper (set), section, the exact current wording and your proposed wording. Group identical findings that affect all papers.
4. **Spring Boot notes:** anything that only a Spring Boot student would hit (coercion, default error pages) and whether the papers warn about it.
5. **Typical-student check:** the table of ten mistakes against the tests that caught them.
6. **What you could not verify** (for example, no Maven or JDK in the environment, or no Atlas URI) and which results are therefore missing.

## 8. Environment checks

Start by running `node --version`, `java -version` and `mvn -v`. If the JDK or Maven is missing, say so, build and test all 10 Express projects, still write the Spring Boot projects, and mark them **"written but not run"** in the report. Never claim a project passed without running it.

## 9. Self-check before you finish

- [ ] 10 Express projects and 10 Spring Boot projects exist, each with a README, and none imports from `assessment-platform`.
- [ ] No solution read the platform's domain configs or reference server (you built from the papers only).
- [ ] Every solution you could run scored 100/100 on three seeds, or has an entry in `FINDINGS.md` explaining each failed test.
- [ ] The assessment kit was run end to end for the assessment sets and printed no score.
- [ ] `results/` holds the output of every run.
- [ ] `FINDINGS.md` has all six parts.

## 10. In your final summary

Give the results table in short form, the number of platform findings and paper findings, and the three most important items the trainer should look at first.
