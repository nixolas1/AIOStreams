import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAudio, isUndecodable, langCode, sameLang, audioLabel, subtitleLabel } from '../app/js/player/tracks.js';

const A = (id, lang, codec) => ({ id, lang, codec });

test('DTS and TrueHD are undecodable', () => {
  assert.ok(isUndecodable('DTS '));
  assert.ok(isUndecodable('dtsh'));
  assert.ok(isUndecodable('TRUEHD'));
  assert.ok(!isUndecodable('EAC3'));
  assert.ok(!isUndecodable(''));
});

test('chooseAudio keeps a decodable current track', () => {
  const t = [A(1, 'eng', 'EAC3'), A(2, 'eng', 'DTS '), A(3, 'fra', 'AC3')];
  assert.equal(chooseAudio(t, 1, ''), 1);
});

test('chooseAudio swaps a DTS default for a same-language decodable track', () => {
  const t = [A(1, 'eng', 'DTS '), A(2, 'fra', 'AC3'), A(3, 'eng', 'AC3')];
  assert.equal(chooseAudio(t, 1, ''), 3);
});

test('chooseAudio honours the preferred language, avoiding DTS inside it', () => {
  const t = [A(1, 'eng', 'AC3'), A(2, 'jpn', 'DTSH'), A(3, 'jpn', 'AAC')];
  assert.equal(chooseAudio(t, 1, 'ja'), 3);
});

test('chooseAudio falls back to any decodable track, then to the original', () => {
  assert.equal(chooseAudio([A(1, 'eng', 'DTS '), A(2, 'fra', 'AC3')], 1, ''), 2);
  assert.equal(chooseAudio([A(1, 'eng', 'DTS ')], 1, ''), 1);
  assert.equal(chooseAudio([], 1, ''), null);
});

test('language codes', () => {
  assert.equal(langCode('eng'), 'en');
  assert.equal(langCode('en-US'), 'en');
  assert.equal(langCode('und'), '');
  assert.ok(sameLang('fre', 'fra'));
  assert.ok(!sameLang('eng', 'jpn'));
  assert.ok(!sameLang('', ''));
});

test('labels', () => {
  assert.equal(audioLabel(A(1, 'eng', 'EAC3'), 1), 'English  ·  DD+');
  assert.equal(audioLabel(A(2, '', ''), 2), 'Track 2');
  assert.equal(subtitleLabel({ Language: 'eng', DisplayTitle: 'English (SRT)' }, 1), 'English');
  assert.equal(subtitleLabel({ Language: 'eng', Title: 'English SDH' }, 1), 'English  ·  SDH');
  assert.equal(subtitleLabel({}, 3), 'Subtitle 3');
});
