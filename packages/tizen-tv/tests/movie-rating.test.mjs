import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';
globalThis.localStorage = fakeStorage();
const rating = await import('../app/js/api/movie-rating.js');

test('saved threshold, inclusive boundary, missing ratings and series', () => {
  rating.setMinimum(7.5);
  assert.equal(rating.minimum(), 7.5);
  assert.equal(rating.label(), '★ 7.5+ / 10');
  for (const value of [null, undefined, '', 'bad', 7.4, 11]) assert.equal(rating.matches({ Type: 'Movie', CommunityRating: value }, 7.5), false);
  assert.equal(rating.matches({ Type: 'Movie', CommunityRating: 7.5 }, 7.5), true);
  assert.equal(rating.matches({ Type: 'Series' }, 7.5), true);
  assert.equal(rating.matches({ Type: 'Movie' }, 0), true);
  rating.setMinimum(999);
  assert.equal(rating.minimum(), 0);
});

test('sparse pages retain later matches, ordered concurrent requests and exact final total', async () => {
  const all = Array.from({ length: 440 }, (_, i) => ({ Id: String(i), Type: 'Movie', CommunityRating: i >= 350 ? 8 : 3 }));
  const fetchPage = rating.pager(async p => ({ items: all.slice(p.start, p.start + p.limit), total: all.length }), it => rating.matches(it, 8));
  const [first, second] = await Promise.all([fetchPage({ start: 0, limit: 24 }), fetchPage({ start: 24, limit: 100 })]);
  assert.equal(first.items[0].Id, '350');
  assert.equal(first.items.length, 24);
  assert.equal(second.items[0].Id, '374');
  assert.equal(second.total, 90);
  assert.equal(second.items.length, 66);
});
