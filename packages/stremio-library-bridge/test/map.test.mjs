import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapLibrary } from '../src/map.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/library.json', import.meta.url), 'utf8')
);
const out = mapLibrary(fixture);
const item = (id) => out.items.find((i) => i.metaId === id);
const fav = (id) => out.watchlist.find((i) => i.metaId === id);

test('movie resume uses the movie id as video id', () => {
  assert.deepEqual(item('tt0111161'), {
    type: 'movie',
    metaId: 'tt0111161',
    videoId: 'tt0111161',
    positionMs: 3600000,
    durationMs: 8400000,
    at: Date.parse('2024-03-01T00:00:00.000Z'),
  });
});

test('series resume keeps the episode video id untouched', () => {
  const s = item('tt0903747');
  assert.equal(s.videoId, 'tt0903747:3:11');
  assert.equal(s.season, undefined);
  assert.equal(s.episode, undefined);
});

test('anime with a kitsu id passes through', () => {
  const a = item('kitsu:42323');
  assert.equal(a.videoId, 'kitsu:42323:5');
  assert.equal(a.type, 'anime');
  // lastWatched is null, so _mtime is used
  assert.equal(a.at, Date.parse('2024-01-05T00:00:00.000Z'));
  assert.equal(fav('kitsu:42323').kind, 'series');
});

test('timeOffset 0 is a favorite without a resume point', () => {
  assert.equal(item('tt0068646'), undefined);
  assert.ok(fav('tt0068646'));
});

test('removed items are in neither list', () => {
  assert.equal(item('tt0944947'), undefined);
  assert.equal(fav('tt0944947'), undefined);
});

test('temp items resume but are not favorites', () => {
  assert.ok(item('tt0133093'));
  assert.equal(fav('tt0133093'), undefined);
});

test('other and channel types are skipped', () => {
  for (const id of ['yt_id_abc', 'tt0050083']) {
    assert.equal(item(id), undefined);
    assert.equal(fav(id), undefined);
  }
});

test('series without a usable video id has no resume point', () => {
  assert.equal(item('tt0306414'), undefined);
  assert.equal(item('tt0108778'), undefined);
  assert.ok(fav('tt0306414'));
});

test('movie without video_id falls back to its id, no duration', () => {
  const m = item('tt0120737');
  assert.equal(m.videoId, 'tt0120737');
  assert.equal('durationMs' in m, false);
});

test('malformed entries are ignored and bad dates drop `at`', () => {
  assert.equal(item('tt0000001'), undefined);
  assert.equal('at' in fav('tt0000001'), false);
  assert.equal(fav('tt0000001').kind, 'movie');
});

test('lists are sorted newest first and capped', () => {
  const ats = out.items.map((i) => i.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => b - a));
  const capped = mapLibrary(fixture, { maxItems: 1, maxWatchlist: 2 });
  assert.equal(capped.items.length, 1);
  assert.equal(capped.items[0].metaId, 'tt0133093');
  assert.equal(capped.watchlist.length, 2);
});

test('non-array input yields empty lists', () => {
  assert.deepEqual(mapLibrary(null), { items: [], watchlist: [] });
});

test('resume points older than the cutoff are dropped, favorites kept', () => {
  const now = Date.parse('2024-03-02T00:00:00.000Z');
  const aged = mapLibrary(fixture, { maxAgeMs: 30 * 86_400_000, now });
  assert.ok(aged.items.some((i) => i.metaId === 'tt0111161'));
  // last played 2024-01-05, outside the 30-day window
  assert.equal(aged.items.find((i) => i.metaId === 'kitsu:42323'), undefined);
  assert.equal(aged.watchlist.length, out.watchlist.length);
});
