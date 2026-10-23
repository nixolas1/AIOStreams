import test from 'node:test';
import assert from 'node:assert/strict';
import { TMDBMetadata } from './tmdb.js';
import { Cache } from '../utils/cache.js';
import { MemoryCacheBackend } from '../utils/cache-adapter.js';
// Isolated in-memory cache: no application database/configuration is opened.
Object.assign(Cache.getInstance('tmdb_recommendations'), {
  _backend: new MemoryCacheBackend(20),
});

test('regional discovery filters availability, preserves popularity order and isolates country cache', async () => {
  const calls: Array<{ path: string; params: Record<string, string> }> = [];
  const tmdb = new TMDBMetadata({
    apiKey: 'synthetic-test-key',
    accessToken: 'synthetic-test-token',
  });
  Object.assign(tmdb, {
    getJson: async (path: string, params: Record<string, string>) => {
      calls.push({ path, params });
      return {
        results: [
          {
            id: params.watch_region === 'NO' ? 123 : 456,
            name: 'Synthetic show',
            popularity: 12,
          },
        ],
      };
    },
  });
  assert.equal((await tmdb.getRegionalShows('NO'))[0].tmdbId, 123);
  assert.equal((await tmdb.getRegionalShows('SE'))[0].tmdbId, 456);
  await tmdb.getRegionalShows('NO');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/discover/tv');
  assert.equal(calls[0].params.watch_region, 'NO');
  assert.equal(
    calls[0].params.with_watch_monetization_types,
    'flatrate|free|ads'
  );
  assert.equal(calls[0].params.sort_by, 'popularity.desc');
  assert.equal(calls[0].params.include_adult, 'false');
  assert.equal(calls[0].params.with_origin_country, undefined);
  await assert.rejects(tmdb.getRegionalShows('NOR'), /Invalid country/);
});

test('upstream failures are not cached as an empty regional catalog', async () => {
  const tmdb = new TMDBMetadata({
    apiKey: 'synthetic-test-key',
    accessToken: 'synthetic-test-token',
  });
  let failed = true;
  Object.assign(tmdb, {
    getJson: async () => {
      if (failed) throw new Error('upstream unavailable');
      return { results: [] };
    },
  });
  await assert.rejects(tmdb.getRegionalShows('DK'), /unavailable/);
  failed = false;
  assert.deepEqual(await tmdb.getRegionalShows('DK'), []);
});
