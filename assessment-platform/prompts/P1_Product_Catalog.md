# Prompt P1 — add question set P1: Product Catalog (practice)

**Prerequisite:** Prompt 00 (core platform) is complete and `npm test` passes. Do not change any other set's files. The printed question paper for this set was generated from the same config below, so do not edit the config without telling the trainer.

## Steps

1. Create or overwrite `domains/P1.json` with **exactly** this content:

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

2. Do **not** add `P1` to any kit. Practice sets are trainer-only: no student receives an evaluator for them. The trainer CLI discovers the set from `domains/P1.json`.
3. Run `npm run verify -- --set P1`. Expected: the reference passes 100/100 with zero BLOCKED on three seeds, and all **29** mutants that apply to this set are caught (every "must FAIL" test fails).
4. Run `npm test` and confirm the generator invariants pass for `P1` over 200 seeds.
5. Run `npm run trainer -- --set P1 --url <reference server> --reg TEST-0001 --save`. Confirm: full-detail output, one `trainerRuns` document with `setId: P1`, and the dashboard's Trainer runs tab lists it. Confirm no `runs` or `students` document was created.
6. Run it against the `M07` mutant and check the trainer output shows the sent request, the expected value and the actual value for each failed test.
7. Confirm `npm run build-kits` still produces a kit that contains no file for P1.

## Facts for this set (check the engine handles each)

- `stock` may be 0 (minimum 0): include 0 at least once in the seed data.
- `price` uses 2 decimals up to 100000.
- This set has **no unique field**: C14, U10 and P10 use the 'duplicates are allowed' variants. Mutant M23 applies; M21 and M22 do not.
- Enum filter parameter: `category` (values: Electronics, Books, Clothing, Home, Sports). Flag filter parameter: `inStock`. Range parameters: `minPrice` / `maxPrice`.
- Search matches `name` or `brand`. Allowed sort fields: `name`, `price`, `stock`.

Applicable mutants for P1:

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

State: verify result per seed, mutants caught (n/29), anything you changed outside `domains/P1.json`, and anything you could not verify.
