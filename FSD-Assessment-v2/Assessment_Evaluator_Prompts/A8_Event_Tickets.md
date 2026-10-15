# Prompt A8 — add question set A8: Event Tickets (assessment)

**Prerequisite:** Prompt 00 (core platform) is complete and `npm test` passes. Do not change any other set's files. The printed question paper for this set was generated from the same config below, so do not edit the config without telling the trainer.

## Steps

1. Create or overwrite `domains/A8.json` with **exactly** this content:

```json
{
  "setId": "A8",
  "mode": "assessment",
  "title": "Event Tickets",
  "resource": "events",
  "text1": {
    "name": "title",
    "minLen": 3,
    "maxLen": 60,
    "searchable": true,
    "sortable": true
  },
  "text2": {
    "name": "venue",
    "minLen": 2,
    "maxLen": 40,
    "searchable": true
  },
  "enum": {
    "name": "category",
    "values": [
      "Music",
      "Tech",
      "Sports",
      "Workshop",
      "Festival"
    ],
    "filterable": true
  },
  "amount": {
    "name": "ticketPrice",
    "exclusiveMin": 0,
    "max": 50000,
    "genMin": 1,
    "genDecimals": 2,
    "rangeFilter": [
      "minTicketPrice",
      "maxTicketPrice"
    ],
    "sortable": true
  },
  "count": {
    "name": "seatsAvailable",
    "integer": true,
    "min": 0,
    "max": 100000,
    "sortable": true
  },
  "flag": {
    "name": "isOnline",
    "filterable": true
  },
  "uniqueCode": null,
  "sample": {
    "title": "DevFest Chennai",
    "venue": "Trade Centre",
    "category": "Tech",
    "ticketPrice": 499,
    "seatsAvailable": 250,
    "isOnline": false
  },
  "sortFields": [
    "title",
    "ticketPrice",
    "seatsAvailable"
  ]
}
```

2. Add `A8` to `kits/assessment/sets.json` (and to nothing else).
3. Run `npm run verify -- --set A8`. Expected: the reference passes 100/100 with zero BLOCKED on three seeds, and all **29** mutants that apply to this set are caught (every "must FAIL" test fails).
4. Run `npm test` and confirm the generator invariants pass for `A8` over 200 seeds.
5. Run `npm run find-reg -- --set A8` to get a registration number that maps to A8. Start the collector with `mongodb-memory-server` (or the real Atlas URI if available), start the reference server for A8, and run the **assessment kit** evaluator with that registration number. Confirm: the kit printed only the success message (no score, no PASS/FAIL), the run is stored, `students.assignedSet` is `A8`, the stored score is 100, and the dashboard lists it.
6. Post a result for this registration number whose `setId` is a **different** set directly to the collector: it must reject it with a clear message.
7. Run `npm run trainer -- --set A8 ...` against the `M07` mutant and confirm the trainer output shows the failures with full detail.

## Facts for this set (check the engine handles each)

- `seatsAvailable` may be 0 (minimum 0): include 0 at least once in the seed data.
- `ticketPrice` uses 2 decimals up to 50000.
- This set has **no unique field**: C14, U10 and P10 use the 'duplicates are allowed' variants. Mutant M23 applies; M21 and M22 do not.
- Enum filter parameter: `category` (values: Music, Tech, Sports, Workshop, Festival). Flag filter parameter: `isOnline`. Range parameters: `minTicketPrice` / `maxTicketPrice`.
- Search matches `title` or `venue`. Allowed sort fields: `title`, `ticketPrice`, `seatsAvailable`.

Applicable mutants for A8:

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
| M23 | `wrongly-unique-text1` | 409 returned when text1 duplicates another record | C14 |
| M24 | `patch-empty-ok` | PATCH with an empty body returns 200 | P04 |
| M25 | `boolean-as-string` | the flag accepts the strings "true"/"yes" | C08 |
| M26 | `page-zero-ok` | page=0 and page=-1 are treated as page 1 | G08 G09 |
| M27 | `flag-false-ignored` | flag=false is treated as no filter | F04 |
| M28 | `total-pages-floor` | totalPages uses floor instead of ceil | G05 |
| M29 | `sort-ignores-order` | order=desc is ignored | O02 |
| M30 | `combined-or` | search and filters are combined with OR | X01 X03 |
| M31 | `default-order-reversed` | default list order is newest first | L08 |

## If something fails

Decide whether the **question paper contract** or the **engine** is wrong by re-reading section 5 of Prompt 00. Fix the engine or the reference server, never weaken a test or relax a bound to make a mutant pass. After any change to `core/`, re-run `npm run verify` for **every set already added** (regression) and report the results.

## Report back

State: verify result per seed, mutants caught (n/29), anything you changed outside `domains/A8.json` and `kits/assessment/sets.json`, and anything you could not verify.
