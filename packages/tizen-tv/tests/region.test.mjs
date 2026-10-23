import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';
globalThis.localStorage = fakeStorage();
const store = await import('../app/js/util/store.js');
const region = await import('../app/js/api/region.js');
const hubs = await import('../app/js/api/hubs.js');
const session = await import('../app/js/session.js');
session.setBase('http://example.test/jellyfin');
session.signIn({ token: 'test', userId: 'test' });
test('region hints require a region, and handle scripts without guessing from language', () => {
  assert.equal(region.localeCountry(['nb-NO']), 'NO');
  assert.equal(region.localeCountry(['zh-Hant-TW']), 'TW');
  assert.equal(region.localeCountry(['en', 'nb']), '');
  assert.equal(region.localeCountry(['en', 'sv-SE']), 'SE');
});
test('manual country and Off survive reload; country enters row identity and request', async () => {
  store.set('discovery.country', 'NO');
  assert.equal(region.country(), 'NO');
  const recipe = hubs.regionalRecipe();
  assert.equal(recipe.title, 'Popular shows available in Norway');
  globalThis.fetch = async function (url) {
    assert.equal(new URL(url).searchParams.get('Country'), 'NO');
    return { ok: true, status: 200, text: async () => JSON.stringify({ Items: [{ Id: 's1', Type: 'Series' }], TotalRecordCount: 1 }) };
  };
  assert.equal((await recipe.fetch()).items[0]._kind, 'series');
  store.set('discovery.country', 'SE');
  assert.notEqual(hubs.regionalRecipe().id, recipe.id);
  store.set('discovery.country', 'off');
  assert.equal(hubs.regionalRecipe(), null);
  store.set('discovery.country', 'bad');
  assert.equal(hubs.regionalRecipe(), null);
});
