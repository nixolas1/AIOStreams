import test from 'node:test';
import assert from 'node:assert/strict';
import { introSegments, introAt } from '../app/js/player/segments.js';
const marker = (start, end, Type = 'Intro') => ({ Type, StartTicks: start * 10000, EndTicks: end * 10000 });
test('accept intro ticks within actual source duration and sort', () => {
  assert.deepEqual(introSegments({ Items: [marker(5000, 8000), marker(0, 3000), marker(1000, 4000, 'Recap')] }, 10000),
    [{ start: 0, end: 3000 }, { start: 5000, end: 8000 }]);
});
test('invalid/missing markers and unknown duration produce no skip targets', () => {
  const bad = [null, {}, marker(-1, 2), marker(4, 4), marker(4, 3), marker(0, 10000), marker(0, 11000),
    marker(0, Infinity), { Type: 'Intro', StartTicks: '0', EndTicks: 10000 }];
  assert.deepEqual(introSegments({ Items: bad }, 10000), []);
  for (const response of [null, {}, { Items: {} }]) assert.deepEqual(introSegments(response, 10000), []);
  for (const duration of [0, undefined, NaN, Infinity]) assert.deepEqual(introSegments({ Items: [marker(0, 1000)] }, duration), []);
});
test('intro is active only within bounds, including after seeking back', () => {
  const segments = [{ start: 1000, end: 3000 }];
  assert.equal(introAt(segments, 999), null);
  assert.equal(introAt(segments, 1000), segments[0]);
  assert.equal(introAt(segments, 2999), segments[0]);
  assert.equal(introAt(segments, 3000), null);
  assert.equal(introAt(segments, 2000), segments[0]);
});
