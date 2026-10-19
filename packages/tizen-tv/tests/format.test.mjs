import test from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../app/js/util/format.js';

const MIN = 600000000;

test('duration', () => {
  assert.equal(f.duration(106 * MIN), '1h 46m');
  assert.equal(f.duration(46 * MIN), '46m');
  assert.equal(f.duration(120 * MIN), '2h 0m');
  assert.equal(f.duration(0), '');
  assert.equal(f.duration(undefined), '');
});

test('clock', () => {
  assert.equal(f.clock(0), '0:00');
  assert.equal(f.clock(65000), '1:05');
  assert.equal(f.clock(3723000), '1:02:03');
  assert.equal(f.clock(-5), '0:00');
});

test('endsAt is 24h wall clock', () => {
  const now = new Date(2024, 0, 1, 20, 30).getTime();
  assert.equal(f.endsAt(75 * 60000, now), '21:45');
  assert.equal(f.endsAt(0, now), '20:30');
});

test('episodeLabel', () => {
  assert.equal(f.episodeLabel({ Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 2 }), 'S1 · E2');
  assert.equal(f.episodeLabel({ Type: 'Episode', IndexNumber: 7 }), 'E7');
  assert.equal(f.episodeLabel({ Type: 'Movie' }), '');
});

test('metaLine movie', () => {
  const m = { Type: 'Movie', ProductionYear: 2008, OfficialRating: 'PG-13', RunTimeTicks: 106 * MIN, CommunityRating: 5.84 };
  assert.equal(f.metaLine(m), '2008  ·  PG-13  ·  1h 46m  ·  ★ 5.8');
});

test('metaLine series uses seasons', () => {
  assert.equal(f.metaLine({ Type: 'Series', ProductionYear: 2019, ChildCount: 3, CommunityRating: 8 }), '2019  ·  3 seasons  ·  ★ 8.0');
  assert.equal(f.metaLine({ Type: 'Series', ProductionYear: 2019, ChildCount: 1 }), '2019  ·  1 season');
});

test('metaLine episode', () => {
  const e = { Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 2, RunTimeTicks: 45 * MIN };
  assert.equal(f.metaLine(e), 'S1 · E2  ·  45m');
  assert.equal(f.metaLine({}), '');
  assert.equal(f.metaLine(null), '');
});

test('progressFraction', () => {
  assert.equal(f.progressFraction({ UserData: { PlayedPercentage: 25 } }), 0.25);
  assert.equal(f.progressFraction({ UserData: { PlayedPercentage: 100 } }), 0);
  assert.equal(f.progressFraction({ UserData: {} }), 0);
  assert.equal(f.progressFraction({}), 0);
  assert.equal(f.progressFraction({ RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 50 } }), 0.5);
});
