import test from 'node:test';
import assert from 'node:assert/strict';
import { playedFileFor, rememberPlayedFile } from './played-file.js';
const source =
  'http://server.test/api/v1/debrid/playback/synthetic/a/b/c/file.mkv';
test('preview cannot resolve an unplayed link or guess a different file', () => {
  assert.equal(playedFileFor(source), undefined);
  rememberPlayedFile(source, 'https://cdn.test/actual-file.mkv');
  assert.equal(
    playedFileFor(source + '?playPath=jellyfin'),
    'https://cdn.test/actual-file.mkv'
  );
  assert.equal(
    playedFileFor(source.replace('/synthetic/', '/other/')),
    undefined
  );
  assert.equal(playedFileFor('https://cdn.test/unplayed.mkv'), undefined);
});
test('a replay refreshes the chosen file and nested resolver URLs are refused', () => {
  rememberPlayedFile(source, 'https://cdn.test/replayed.mkv');
  assert.equal(playedFileFor(source), 'https://cdn.test/replayed.mkv');
  rememberPlayedFile(source + '-new', source);
  assert.equal(playedFileFor(source + '-new'), undefined);
});
