import test from 'node:test';
import assert from 'node:assert/strict';
import { latestResume, watchedAtStop, creditMinutes } from '../app/js/player/progress.js';
const ep = (Id, SeriesId, date, played = false) => ({ Id, SeriesId, Type: 'Episode', UserData: { LastPlayedDate: date, Played: played } });
test('resume keeps latest playback per series, not highest episode or input order', () => {
  const old = ep('ep9', 'a', '2026-10-20T12:00:00Z');
  const recent = ep('ep2', 'a', '2026-10-22T12:00:00Z');
  const other = ep('ep1', 'b', '2026-10-21T12:00:00Z');
  const movie = { Id: 'movie', Type: 'Movie' };
  assert.deepEqual(latestResume([old, movie, other, recent]), [recent, other, movie]);
});
test('missing timestamps preserve server order, unknown series remain distinct', () => {
  const a = ep('a', 's'); const b = ep('b', 's'); const c = ep('c'); const d = ep('d');
  assert.deepEqual(latestResume([a, b, c, d, c]), [a, c, d]);
});
test('finishing the latest episode does not bring an old unfinished episode back', () => {
  const old = ep('old', 's', '2026-10-20T00:00:00Z');
  const recent = { s: { id: 'new', at: Date.parse('2026-10-21T00:00:00Z'), played: true } };
  assert.deepEqual(latestResume([old], recent), []);
  const newer = ep('rewatch', 's', '2026-10-22T00:00:00Z');
  assert.deepEqual(latestResume([old, newer], recent), [newer]);
  assert.deepEqual(latestResume([ep('done', 's', '2026-10-22T00:00:00Z', true), old]), []);
});
test('three-minute cutoff, full completion, short content and unknown duration', () => {
  const duration = 45 * 60000;
  assert.equal(watchedAtStop(duration - 180001, duration, 3), false);
  assert.equal(watchedAtStop(duration - 180000, duration, 3), true);
  assert.equal(watchedAtStop(duration - 1, duration, 0), false);
  assert.equal(watchedAtStop(duration, duration, 0), true);
  assert.equal(watchedAtStop(1, 120000, 3), false);
  assert.equal(watchedAtStop(60000, 120000, 3), true);
  assert.equal(watchedAtStop(1000, 0, 3), false);
  assert.equal(watchedAtStop(NaN, duration, 3), false);
  assert.equal(creditMinutes(undefined), 3);
  assert.equal(creditMinutes(0), 0);
});
