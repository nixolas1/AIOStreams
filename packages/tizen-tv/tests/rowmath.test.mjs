import test from 'node:test';
import assert from 'node:assert/strict';
import { poolSizeFor, poolWindow, slotOf, trackX, rowHeight } from '../app/js/ui/row.js';
import { gridWindow, gridMove } from '../app/js/ui/grid.js';

test('pool sizes cover the screen plus behind/ahead', () => {
  assert.equal(poolSizeFor(400), 9);
  assert.equal(poolSizeFor(220), 12);
});

test('poolWindow keeps 2 behind and never exceeds the pool', () => {
  const size = poolSizeFor(220);
  assert.deepEqual(poolWindow(0, 50, size), { first: 0, last: size });
  assert.deepEqual(poolWindow(10, 50, size), { first: 8, last: 8 + size });
  assert.deepEqual(poolWindow(49, 50, size), { first: 47, last: 50 });
  assert.deepEqual(poolWindow(0, 0, size), { first: 0, last: 0 });
});

test('slots in a window are distinct', () => {
  const size = 9;
  for (let idx = 0; idx < 40; idx++) {
    const w = poolWindow(idx, 40, size);
    const seen = new Set();
    for (let i = w.first; i < w.last; i++) seen.add(slotOf(i, size));
    assert.equal(seen.size, w.last - w.first);
  }
});

test('track and row geometry', () => {
  assert.equal(trackX(3, 428), -1284);
  assert.equal(rowHeight('wide'), 313);
  assert.equal(rowHeight('poster'), 418);
  assert.equal(rowHeight('grid'), 64 + 324 + 70 + 24);
});

test('gridWindow: focused row second from top', () => {
  const w0 = gridWindow(0, 7, 100, 6);
  assert.equal(w0.scrollRow, 0);
  assert.equal(w0.firstRow, 0);
  const w = gridWindow(7 * 5 + 2, 7, 100, 6);
  assert.equal(w.focusRow, 5);
  assert.equal(w.scrollRow, 4);
  assert.equal(w.firstRow, 3);
  assert.equal(w.lastRow, 9);
  assert.equal(gridWindow(99, 7, 100, 6).lastRow, 15);
});

test('gridMove edges and short last row', () => {
  assert.equal(gridMove(0, -1, 0, 7, 20), -1);
  assert.equal(gridMove(6, 1, 0, 7, 20), -1);
  assert.equal(gridMove(0, 0, -1, 7, 20), -1);
  assert.equal(gridMove(8, 0, 1, 7, 17), 15);
  assert.equal(gridMove(13, 0, 1, 7, 17), 16); // short last row -> last item
  assert.equal(gridMove(16, 0, 1, 7, 17), -1);
});
