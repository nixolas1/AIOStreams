import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepFor, Seeker } from '../app/js/player/seek.js';

test('step escalation: 10s x3, 30s, 60s, 180s from press 16', () => {
  const s = [];
  for (let n = 0; n < 20; n++) s.push(stepFor(n) / 1000);
  assert.deepEqual(s.slice(0, 3), [10, 10, 10]);
  assert.deepEqual(s.slice(3, 8), [30, 30, 30, 30, 30]);
  assert.deepEqual(s.slice(8, 16), [60, 60, 60, 60, 60, 60, 60, 60]);
  assert.deepEqual(s.slice(16), [180, 180, 180, 180]);
});

test('presses within the gap accumulate from the pending target', () => {
  const k = new Seeker();
  const D = 3600000;
  assert.equal(k.press(1, 1000, 600000, D), 610000);
  assert.equal(k.press(1, 1300, 600000, D), 620000);
  assert.equal(k.press(1, 1600, 600000, D), 630000);
  assert.equal(k.press(1, 1900, 600000, D), 660000, '4th press steps 30s');
  assert.equal(k.press(-1, 2200, 600000, D), 630000, 'direction can reverse');
  assert.ok(k.pending());
});

test('a pause longer than 700 ms restarts the streak', () => {
  const k = new Seeker();
  for (let i = 0; i < 5; i++) k.press(1, 1000 + i * 100, 0, 3600000);
  assert.equal(k.count, 4);
  const t0 = k.target;
  assert.equal(k.press(1, 3000, 0, 3600000), t0 + 10000);
  assert.equal(k.count, 0);
});

test('clamped to 0 and just before the end; commit and cancel clear it', () => {
  const k = new Seeker();
  assert.equal(k.press(-1, 0, 5000, 100000), 0);
  k.cancel();
  assert.equal(k.press(1, 5000, 95000, 100000), 97000);
  assert.equal(k.commit(), 97000);
  assert.equal(k.pending(), false);
  assert.equal(k.commit(), null);
  k.press(1, 9000, 0, 100000);
  k.cancel();
  assert.equal(k.pending(), false);
});
