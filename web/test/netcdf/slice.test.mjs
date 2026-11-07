import test from 'node:test';
import assert from 'node:assert/strict';
import { viewToHyperslab, toRows, toH5Ranges, forEachIndex, stepFor, product } from '../../src/netcdf/core/slice.mjs';

test('2D view of a 3D variable fixes the other dims', () => {
  const hs = viewToHyperslab([24, 73, 144], { rowAxis: 1, colAxis: 2, index: [5, 0, 0], rowCount: 10, colCount: 30, colStart: 140 });
  assert.deepEqual(hs.start, [5, 0, 140]);
  assert.deepEqual(hs.count, [1, 10, 4]);
  assert.equal(hs.transpose, false);
  assert.deepEqual(toH5Ranges(hs), [[5, 6, 1], [0, 10, 1], [140, 144, 1]]);
});

test('transposed view returns rows of the row axis', () => {
  const hs = viewToHyperslab([2, 3], { rowAxis: 1, colAxis: 0, rowCount: 3, colCount: 2 });
  assert.equal(hs.transpose, true);
  // native row-major data [[0,1,2],[3,4,5]]
  assert.deepEqual(toRows([0, 1, 2, 3, 4, 5], hs), [[0, 3], [1, 4], [2, 5]]);
});

test('steps sample the array and the end stays exclusive', () => {
  const hs = viewToHyperslab([1000], { rowAxis: 0, colAxis: -1, rowCount: 1000, rowStep: 300 });
  assert.deepEqual(hs.count, [4]);
  assert.deepEqual(toH5Ranges(hs), [[0, 901, 300]]);
  assert.equal(stepFor(100, 512), 1);
  assert.equal(stepFor(100000, 512), 196);
});

test('out of range input is clamped, bad axes throw', () => {
  const hs = viewToHyperslab([10, 10], { rowAxis: 0, colAxis: 1, rowStart: 50, rowCount: 5, colCount: 5, index: [] });
  assert.deepEqual(hs.start, [9, 0]);
  assert.deepEqual(hs.count, [1, 5]);
  assert.throws(() => viewToHyperslab([10, 10], { rowAxis: 0, colAxis: 0 }));
  assert.throws(() => viewToHyperslab([10], { rowAxis: 3 }));
  const z = viewToHyperslab([0, 4], { rowAxis: 0, colAxis: 1 });
  assert.equal(product(z.count), 0);
  assert.deepEqual(viewToHyperslab([], {}).count, []);
});

test('forEachIndex walks row-major', () => {
  const seen = [];
  forEachIndex({ start: [1, 0], count: [2, 2], step: [1, 3] }, i => seen.push(i.join(',')));
  assert.deepEqual(seen, ['1,0', '1,3', '2,0', '2,3']);
});
