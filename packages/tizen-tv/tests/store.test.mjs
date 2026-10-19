import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';

globalThis.localStorage = fakeStorage();
const store = await import('../app/js/util/store.js');

test('round-trips JSON under the atv. prefix', () => {
  assert.equal(store.set('a', { x: [1, 2] }), true);
  assert.deepEqual(store.get('a'), { x: [1, 2] });
  assert.ok(localStorage._map.has('atv.a'));
});

test('fallback when missing or corrupt', () => {
  assert.equal(store.get('missing', 7), 7);
  localStorage.setItem('atv.bad', '{nope');
  assert.equal(store.get('bad', 'fb'), 'fb');
});

test('undefined removes; remove works', () => {
  store.set('b', 1);
  store.set('b', undefined);
  assert.equal(store.get('b', null), null);
  store.set('c', 1);
  store.remove('c');
  assert.equal(store.get('c', null), null);
});

test('never throws when storage throws', () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
  assert.equal(store.get('a', 'fb'), 'fb');
  assert.equal(store.set('a', 1), false);
  globalThis.localStorage = saved;
});
