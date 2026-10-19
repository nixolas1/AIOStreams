import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSources, pickSource, nextSource, judge, describeSource, nameLines } from '../app/js/player/pick.js';

const src = (id, name, extra) => Object.assign({ Id: id, Name: name }, extra || {});

const WEB4K = src('a', '4K · WEB-DL · 18.2 GB · Cached\nHEVC · DV · HDR10 · DDP 5.1 Atmos\nEN · Torrentio · FLUX');
const BLURAY_DTS = src('b', '1080p · BluRay · 12 GB · Cached\nx264 · DTS-HD MA 5.1\nEN · Comet · SPARKS');
const WEB1080 = src('c', '1080p · WEB-DL · 6.4 GB · Cached\nH264 · DD 5.1\nEN · MediaFusion · NTb');
const DV_ONLY = src('d', '4K · Remux · 60 GB · Cached\nHEVC · DV · TrueHD Atmos 7.1 · DD 5.1\nEN · Torrentio · FraMeSToR');
const AVI_OLD = src('e', '720p · DVDRip\nXviD · MP3\nEN · X', { Container: 'avi' });

test('DTS-only sources are rejected, DDP ones are fine', () => {
  assert.equal(judge(BLURAY_DTS).playable, false);
  assert.match(judge(BLURAY_DTS).reasons[0], /DTS/);
  assert.equal(judge(WEB4K).playable, true);
  assert.equal(judge(WEB1080).playable, true);
});

test('DTS next to a decodable track is playable', () => {
  const mixed = src('m', '1080p · BluRay\nHEVC · DTS-HD MA 5.1 · DD 5.1\nEN');
  assert.equal(judge(mixed).playable, true);
});

test('TrueHD alone is playable with a passthrough warning', () => {
  const t = src('t', '2160p · Remux\nHEVC · TrueHD 7.1 Atmos\nEN');
  const j = judge(t);
  assert.equal(j.playable, true);
  assert.equal(j.warn, true);
  assert.match(j.reasons[0], /TrueHD/);
});

test('MediaStreams win over the name text', () => {
  const s = src('s', '1080p · WEB-DL\nH264 · DDP 5.1', {
    Container: 'matroska,webm',
    MediaStreams: [
      { Type: 'Video', Codec: 'hevc' },
      { Type: 'Audio', Codec: 'dts' },
      { Type: 'Subtitle', Codec: 'srt' },
    ],
  });
  const f = describeSource(s);
  assert.deepEqual(f.video, ['hevc']);
  assert.deepEqual(f.audio, ['dts']);
  assert.equal(f.container, 'mkv');
  assert.equal(judge(s).playable, false);
});

test('unknown facts never reject', () => {
  const s = src('u', 'Some release name');
  assert.equal(judge(s).playable, true);
  assert.deepEqual(judge(s).reasons, []);
});

test('unsupported container and video codec are rejected', () => {
  assert.equal(judge(src('x', 'x', { Container: 'flv' })).playable, false);
  assert.equal(judge(src('y', 'x', { MediaStreams: [{ Type: 'Video', Codec: 'wmv3' }] })).playable, false);
  assert.equal(judge(AVI_OLD).playable, true);
});

test('Dolby Vision without an HDR fallback is deprioritised, not rejected', () => {
  const dv = src('dv', '4K · WEB-DL\nHEVC · DV · DDP 5.1\nEN');
  const j = judge(dv);
  assert.equal(j.playable, true);
  assert.equal(j.warn, true);
  assert.match(j.reasons[0], /Dolby Vision/);
  assert.equal(judge(WEB4K).warn, false, 'DV + HDR10 has a fallback');
  const viaTags = src('dt', '4K\nHEVC', { aiostreams: { visualTags: ['DV', 'HDR10+'], audioTags: ['DD+'] } });
  assert.equal(judge(viaTags).warn, false);
});

test('rankSources keeps server order within each group', () => {
  const ranked = rankSources([DV_ONLY, BLURAY_DTS, WEB4K, WEB1080, AVI_OLD]);
  // DV_ONLY has TrueHD + DD 5.1 -> playable; it has no HDR token so it is a warning.
  assert.equal(ranked[0].source.Id, 'a');
  assert.deepEqual(ranked.slice(0, 3).map((r) => r.source.Id), ['a', 'c', 'e']);
  assert.equal(ranked[3].source.Id, 'd');
  assert.equal(ranked[3].warn, true);
  assert.equal(ranked[4].source.Id, 'b');
  assert.equal(ranked[4].playable, false);
});

test('pickSource: first clean playable; falls back to the first real source', () => {
  assert.equal(pickSource([BLURAY_DTS, WEB1080, WEB4K]).Id, 'c');
  assert.equal(pickSource([BLURAY_DTS, src('n', 'Notice', { Type: 'Placeholder' })]).Id, 'b');
  assert.equal(pickSource([]), null);
  assert.equal(pickSource([src('n', 'Notice', { Type: 'Placeholder' })]), null);
});

test('nextSource walks the ranking after the failed one', () => {
  const list = [BLURAY_DTS, WEB4K, WEB1080];
  assert.equal(nextSource(list, WEB4K).Id, 'c');
  assert.equal(nextSource(list, WEB1080), null);
});

test('nameLines splits the compact name', () => {
  assert.deepEqual(nameLines(WEB1080), ['1080p · WEB-DL · 6.4 GB · Cached', 'H264 · DD 5.1', 'EN · MediaFusion · NTb']);
  assert.deepEqual(nameLines({}), ['Source']);
});
