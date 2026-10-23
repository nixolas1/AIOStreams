import test from 'node:test';
import assert from 'node:assert/strict';
import { TMDBMetadata } from './tmdb.js';
import { norwegianShowOptions, norwegianShowQuery } from './norwegian-shows.js';
import { Cache } from '../utils/cache.js';
import { MemoryCacheBackend } from '../utils/cache-adapter.js';
Object.assign(Cache.getInstance('tmdb_recommendations'), {
  _backend: new MemoryCacheBackend(100),
});
const now = new Date('2026-10-23T12:00:00Z');
const client = () =>
  new TMDBMetadata({ apiKey: 'synthetic', accessToken: 'synthetic' });

test('episode date ranges cover month/year including returning seasons, in Norwegian time', () => {
  const year = norwegianShowQuery(norwegianShowOptions()!, now);
  assert.equal(year['air_date.gte'], '2026-01-01');
  assert.equal(year['air_date.lte'], '2026-10-23');
  assert.equal(year['first_air_date.gte'], undefined);
  assert.equal(year.watch_region, undefined);
  assert.equal(year.with_origin_country, undefined);
  assert.equal(year.without_genres, '10763');
  const month = norwegianShowQuery(
    norwegianShowOptions({ period: 'month' })!,
    new Date('2026-10-31T23:30:00Z')
  );
  assert.equal(month['air_date.gte'], '2026-11-01');
  assert.equal(month['air_date.lte'], '2026-11-01');
  const all = norwegianShowQuery(
    norwegianShowOptions({
      period: 'all',
      includeNews: true,
      source: 'hbo',
      category: 'drama',
    })!,
    now
  );
  assert.equal(all['air_date.gte'], undefined);
  assert.equal(all.without_genres, undefined);
  assert.equal(all.with_genres, '18|80|9648');
  assert.equal(all.with_networks, '1062|3186|6783');
});

test('invalid filters are rejected instead of silently serving the wrong list', () => {
  for (const input of [
    { period: 'weekly' },
    { source: 'unknown' },
    { source: '__proto__' },
    { category: 'unknown' },
    { includeNews: 'true' },
  ])
    assert.equal(norwegianShowOptions(input), null);
});

test('all Norwegian language variants are merged, deduplicated and ranked globally to 20', async () => {
  const tmdb = client();
  const calls: Record<string, string>[] = [];
  Object.assign(tmdb, {
    getJson: async (path: string, params: Record<string, string>) => {
      assert.equal(path, '/discover/tv');
      calls.push(params);
      const offset =
        params.with_original_language === 'no'
          ? 0
          : params.with_original_language === 'nb'
            ? 10
            : 20;
      return {
        results: Array.from({ length: 20 }, (_, i) => ({
          id: i + offset,
          name: 'Synthetic ' + (i + offset),
          popularity: 100 - i - offset,
        })),
      };
    },
  });
  const titles = await tmdb.getNorwegianShows({}, now);
  assert.deepEqual(calls.map((x) => x.with_original_language).sort(), [
    'nb',
    'nn',
    'no',
  ]);
  assert.equal(titles.length, 20);
  assert.deepEqual(
    titles.map((t) => t.tmdbId),
    Array.from({ length: 20 }, (_, i) => i)
  );
  await tmdb.getNorwegianShows({}, now);
  assert.equal(calls.length, 3, 'same query is cached');
  await tmdb.getNorwegianShows({ source: 'nrk' }, now);
  assert.equal(calls.length, 6);
  assert.equal(calls[3].with_networks, '379|843|1942|7722');
  await tmdb.getNorwegianShows(
    { period: 'month', category: 'comedy', includeNews: true },
    now
  );
  assert.equal(calls.length, 9);
  assert.equal(calls[6].with_genres, '35');
  assert.equal(calls[6].without_genres, undefined);
  await tmdb.getNorwegianShows({}, new Date('2027-01-01T12:00:00Z'));
  assert.equal(calls.length, 12, 'calendar change has a new cache key');
});

test('one language failing does not produce or cache an incomplete ranking; empty stays empty', async () => {
  const tmdb = client();
  let fail = true;
  Object.assign(tmdb, {
    getJson: async (_: string, params: Record<string, string>) => {
      if (fail && params.with_original_language === 'nb')
        throw new Error('upstream down');
      return { results: [] };
    },
  });
  await assert.rejects(
    tmdb.getNorwegianShows({ source: 'netflix' }, now),
    /upstream down/
  );
  fail = false;
  assert.deepEqual(
    await tmdb.getNorwegianShows({ source: 'netflix' }, now),
    []
  );
});
