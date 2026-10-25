import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packetText, previewTracks } from './subtitle-preview.js';

test('real ffprobe ASS packets preserve languages, timings and dialogue commas', () => {
  const output = JSON.parse(
    readFileSync(
      new URL('../../test/subtitle-preview-packets.json', import.meta.url),
      'utf8'
    )
  );
  const tracks = previewTracks(output.streams, output.packets);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].lang, 'eng');
  assert.equal(tracks[1].lang, 'nor');
  assert.deepEqual(tracks[0].cues[1], {
    start: 70000,
    end: 73000,
    text: 'English ahead, with commas',
  });
  assert.equal(tracks[1].cues[0].text, 'Tidligere norsk tekst');
});
test('text decoder rejects bitmap codecs', () => {
  const data = '\n00000000: 4869                                     Hi\n';
  assert.equal(packetText(data, 'subrip'), 'Hi');
  assert.equal(packetText(data, 'hdmv_pgs_subtitle'), '');
  assert.equal(packetText('garbage', 'ass'), '');
});
