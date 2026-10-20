import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapIndex, nextZone } from '../app/js/ui/spotlight.js';

test('wrapIndex wraps both ways and handles empty', () => {
  assert.equal(wrapIndex(0, 1, 5), 1);
  assert.equal(wrapIndex(4, 1, 5), 0);
  assert.equal(wrapIndex(0, -1, 5), 4);
  assert.equal(wrapIndex(2, 0, 5), 2);
  assert.equal(wrapIndex(0, 1, 0), 0);
});

test('nextZone: nav, hero and rows boundaries', () => {
  assert.equal(nextZone('nav', 'down', true, false), 'hero');
  assert.equal(nextZone('nav', 'down', false, false), 'rows');
  assert.equal(nextZone('nav', 'left', true, false), '');
  assert.equal(nextZone('hero', 'up', true, false), 'nav');
  assert.equal(nextZone('hero', 'back', true, false), 'nav');
  assert.equal(nextZone('hero', 'down', true, false), 'rows');
  assert.equal(nextZone('hero', 'left', true, false), '');
  assert.equal(nextZone('rows', 'up', true, true), 'hero');
  assert.equal(nextZone('rows', 'back', true, true), 'hero');
  assert.equal(nextZone('rows', 'up', false, true), 'nav');
  assert.equal(nextZone('rows', 'up', true, false), '');
  assert.equal(nextZone('rows', 'down', true, true), '');
});
