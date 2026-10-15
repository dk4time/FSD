# Assessment platform — how to use these files

## What you have
| File | What it is |
|---|---|
| `Assessment_Question_Papers.zip` | 10 printable papers: P1, P2 (practice) and A1–A8 (assessment). Each paper lists endpoints, rules, examples, how the evaluator works and the marking scheme. |
| `prompts/00_CORE_platform.md` | Claude Code prompt that builds the whole platform: evaluator engine, trainer CLI, collector, Atlas storage, the assessment kit, reference servers. |
| `prompts/P1, P2, A1 … A8` | One prompt per question set. Each adds that set and proves it with a reference server plus deliberately broken servers. |

## Who gets what
| | Practice (P1, P2) | Assessment (A1–A8) |
|---|---|---|
| Question paper | yes | yes (set assigned from registration number) |
| Evaluator | **no**, students test with Postman using the checklist in the paper | sealed `assessment-kit.zip`, shows **no marks**, prints only a success message |
| Your marks view | `npm run trainer -- --set P1 --url <student url>` | `/admin` dashboard (Atlas) + `npm run trainer` to re-run any student's code |

## Order
1. Create an empty folder `assessment-platform/`, open Claude Code in it, and run `00_CORE_platform.md`.
2. Run the ten set prompts one at a time (P1, P2, A1 … A8). Each one ends with a verify run; do not start the next until it passes.
3. **Atlas:** create a free cluster, a database user with `readWrite` on `webdev_assessment` only, and a Network Access entry for your laptop's IP. Put the connection string in `collector/.env` — never in anything students receive.
4. `npm run check-atlas`, then start the collector (`cd collector && npm start`). It prints the URL students must use.
5. Give practice papers to students well before assessment day. On assessment day run `npm run build-kits` and share `dist/assessment-kit.zip` together with the paper for each student's set.
6. Before the real day: run one real student-style Express API **and one Spring Boot API** through `npm run trainer`. The evaluator only speaks HTTP so both should work, but the Spring Boot run is the one thing the reference servers cannot prove.

## Things to know
- Students can read the assessment kit's code. Randomised data, server-side set assignment, the checksum and the collector never returning scores make cheating harder, not impossible. Spot-check a few students by re-running their code with `npm run trainer` and asking them to explain an endpoint.
- Students never see marks in the kit. If a student's POST is broken they get no hint from the evaluator, which is intended.
- Set assignment comes from the registration number (SHA-256 mod 8), so neighbours often get different sets but not always.
- Every run is recorded. The dashboard shows best and latest, you decide which counts.
- Question papers have no duration line; add it by hand if you want one.
