import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';
globalThis.localStorage = fakeStorage();
const store = await import('../app/js/util/store.js');
const norwegian = await import('../app/js/api/norwegian.js');
const hubs = await import('../app/js/api/hubs.js');
const session = await import('../app/js/session.js');
session.setBase('http://example.test/jellyfin');
session.signIn({ token: 'test', userId: 'test' });
test('defaults match the approved list and old country selection cannot change the language', () => {
  store.set('discovery.country', 'US');
  assert.equal(norwegian.enabled(), true);
  assert.deepEqual(norwegian.options(), { period: 'year', category: 'all', source: 'all', includeNews: false });
  assert.equal(norwegian.title(), 'Norske serier · This year');
  store.set('discovery.country', 'off');
  assert.equal(hubs.norwegianRecipe(), null);
  norwegian.set('enabled', true);
  assert.ok(hubs.norwegianRecipe());
});
test('every filter changes row identity and request, not just the heading', async () => {
  const before = hubs.norwegianRecipe();
  norwegian.set('period', 'month'); norwegian.set('category', 'drama'); norwegian.set('source', 'nrk'); norwegian.set('includeNews', true);
  const recipe = hubs.norwegianRecipe();
  assert.notEqual(recipe.id, before.id);
  assert.equal(recipe.title, 'Norske serier · This month · Drama / crime · NRK');
  globalThis.fetch = async function (url) {
    const u = new URL(url);
    assert.ok(u.pathname.endsWith('/Discover/NorwegianShows'));
    for (const [key, value] of Object.entries({ Period: 'month', Category: 'drama', Source: 'nrk', IncludeNews: 'true' })) assert.equal(u.searchParams.get(key), value);
    assert.equal(u.searchParams.has('Country'), false);
    return { ok: true, status: 200, text: async () => JSON.stringify({ Items: [{ Id: 's1', Type: 'Series' }], TotalRecordCount: 1 }) };
  };
  assert.equal((await recipe.fetch()).items[0]._kind, 'series');
  norwegian.set('enabled', false);
  assert.equal(hubs.norwegianRecipe(), null);
});
test('invalid saved options recover to defaults; date rollover invalidates cached rows', () => {
  norwegian.set('period', 'broken'); norwegian.set('source', 'broken'); norwegian.set('category', 'broken');
  assert.equal(norwegian.options().period, 'year');
  assert.equal(norwegian.options().source, 'all');
  assert.equal(norwegian.options().category, 'all');
  assert.notEqual(norwegian.signature(new Date(2026, 11, 31)), norwegian.signature(new Date(2027, 0, 1)));
});
