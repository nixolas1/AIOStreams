import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestCue } from '../app/js/player/subtitles.js';
import { audioLabel } from '../app/js/player/tracks.js';
test('nearest preview handles gaps, active cues and ends', () => {
  const cues = [{ start: 100, end: 200, text: 'Hello\nthere' }, { start: 400, end: 500, text: 'Next' }];
  assert.equal(nearestCue(cues, 0), 'Hello there');
  assert.equal(nearestCue(cues, 150), 'Hello there');
  assert.equal(nearestCue(cues, 350), 'Next');
  assert.equal(nearestCue(cues, 900), 'Next');
  assert.equal(nearestCue([], 900), '');
});
test('unknown audio has distinct track numbers and readable MIME codecs', () => {
  assert.equal(audioLabel({ codec: 'Audio/X-EAC3' }, 1), 'Track 1  ·  DD+');
  assert.equal(audioLabel({ codec: 'Audio/X-EAC3' }, 2), 'Track 2  ·  DD+');
  assert.equal(audioLabel({ lang: 'eng', channels: '6', codec: 'eac3' }, 1), 'English  ·  6 ch  ·  DD+');
});
