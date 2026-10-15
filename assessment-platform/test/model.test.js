'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Model, isSortedText, isSortedNumbers } = require('../core/model');

const cfg = {
  setId: 'T1',
  resource: 'things',
  text1: { name: 'name', minLen: 3, maxLen: 60 },
  text2: { name: 'brand', minLen: 2, maxLen: 40 },
  enum: { name: 'kind', values: ['A', 'B', 'C'] },
  amount: { name: 'price', exclusiveMin: 0, max: 1000, genMin: 1, genDecimals: 2, rangeFilter: ['minPrice', 'maxPrice'] },
  count: { name: 'qty', min: 0, max: 100 },
  flag: { name: 'on' },
  uniqueCode: null,
  sortFields: ['name', 'price', 'qty'],
};

function model() {
  const m = new Model(cfg);
  const rows = [
    ['apple pie', 'North Labs', 'A', 10, 5, true],
    ['Banana split', 'South Works', 'B', 2.5, 0, false],
    ['cherry tart', 'North Works', 'A', 99.99, 7, false],
    ['Date loaf', 'Plaza', 'C', 10, 3, true],
    ['elderberry jam', 'Kingsway', 'B', 500, 100, true],
  ];
  rows.forEach(([name, brand, kind, price, qty, on], i) => m.add(i + 1, { name, brand, kind, price, qty, on }));
  return m;
}

const ids = (r) => r.data.map((x) => x.id);

test('defaults: creation order, page 1, limit 10', () => {
  const r = model().query({});
  assert.deepEqual(ids(r), [1, 2, 3, 4, 5]);
  assert.equal(r.total, 5);
  assert.equal(r.totalPages, 1);
});

test('filters combine with AND, range is inclusive', () => {
  const m = model();
  assert.deepEqual(ids(m.query({ kind: 'A' })), [1, 3]);
  assert.deepEqual(ids(m.query({ on: 'false' })), [2, 3]);
  assert.deepEqual(ids(m.query({ kind: 'B', on: 'true' })), [5]);
  assert.deepEqual(ids(m.query({ minPrice: '10', maxPrice: '99.99' })), [1, 3, 4]);
  const empty = m.query({ minPrice: '100', maxPrice: '10' });
  assert.deepEqual(empty.data, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.totalPages, 0);
});

test('search is case-insensitive contains on text1 or text2', () => {
  const m = model();
  assert.deepEqual(ids(m.query({ search: 'NORTH' })), [1, 3]);
  assert.deepEqual(ids(m.query({ search: 'works' })), [2, 3]);
  assert.deepEqual(ids(m.query({ search: 'an' })), [2]);
  assert.deepEqual(ids(m.query({ search: '' })), [1, 2, 3, 4, 5]);
  assert.equal(m.query({ search: 'zzqxj' }).total, 0);
});

test('sort: text ignores case, numbers numeric, desc, ties keep creation order', () => {
  const m = model();
  assert.deepEqual(ids(m.query({ sort: 'name' })), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(m.query({ sort: 'price' })), [2, 1, 4, 3, 5]);
  assert.deepEqual(ids(m.query({ sort: 'price', order: 'desc' })), [5, 3, 1, 4, 2]);
  assert.deepEqual(ids(m.query({ sort: 'qty' })), [2, 4, 1, 3, 5]);
});

test('pagination and processing order filter -> search -> sort -> paginate', () => {
  const m = model();
  const r = m.query({ page: 2, limit: 2 });
  assert.deepEqual(ids(r), [3, 4]);
  assert.equal(r.totalPages, 3);
  assert.deepEqual(ids(m.query({ page: 4, limit: 2 })), []);
  const c = m.query({ on: 'true', search: 'a', sort: 'price', order: 'desc', page: 1, limit: 2 });
  assert.equal(c.total, 3);
  assert.deepEqual(ids(c), [5, 1]);
});

test('update and remove keep the model in step', () => {
  const m = model();
  m.update(2, { price: 1000 });
  assert.deepEqual(ids(m.query({ sort: 'price', order: 'desc', limit: 1 })), [2]);
  m.remove('2');
  assert.equal(m.query({}).total, 4);
  assert.equal(m.get(2), undefined);
});

test('sort checkers', () => {
  assert.ok(isSortedText(['apple', 'Banana', 'cherry']));
  assert.ok(!isSortedText(['Banana', 'Zed', 'apple']));
  assert.ok(isSortedText(['c', 'B', 'a'], true));
  assert.ok(isSortedNumbers([1, 2, 2, 10]));
  assert.ok(!isSortedNumbers([1, 10, 2]));
  assert.ok(isSortedNumbers([10, 2, 2, 1], true));
});
