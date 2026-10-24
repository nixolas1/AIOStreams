import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';
globalThis.localStorage = fakeStorage();
const anime = await import('../app/js/api/anime-discovery.js');
const hubs = await import('../app/js/api/hubs.js');
const session = await import('../app/js/session.js');
session.setBase('http://example.test/jellyfin');
session.signIn({ token: 'synthetic', userId: 'synthetic' });
test('seasonal options change endpoint query and cache identity', async () => {
  const old = hubs.animeRecipes()[0].id;
  anime.set('sort', 'rating'); anime.set('minimum', 70);
  const row = hubs.animeRecipes()[0];
  assert.notEqual(row.id, old);
  globalThis.fetch = async url => {
    const u = new URL(url);
    assert.equal(u.pathname, '/jellyfin/Discover/SeasonalAnime');
    assert.equal(u.searchParams.get('Sort'), 'rating');
    assert.equal(u.searchParams.get('Minimum'), '70');
    assert.equal(u.searchParams.get('Row'), 'debuts');
    return { ok: true, status: 200, text: async () => JSON.stringify({ Items: [{ Id: 'synthetic', Type: 'Series', AnimeDiscoveryLabel: 'AniList 75/100' }], TotalRecordCount: 1 }) };
  };
  const item = (await row.fetch()).items[0];
  assert.equal(item._kind, 'anime');
  assert.equal(hubs.slim(item).AnimeDiscoveryLabel, item.AnimeDiscoveryLabel);
});
test('quarter rollover and invalid saved values', () => {
  assert.equal(anime.season(new Date('2027-01-01T00:00:00Z')), 'Winter 2027');
  anime.set('sort', 'invalid'); anime.set('minimum', 99);
  assert.deepEqual(anime.options(), { sort: 'trending', minimum: 0 });
});
