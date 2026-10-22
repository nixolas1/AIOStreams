import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCues, stripTags, CueTrack } from '../app/js/player/subtitles.js';

const SRT = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>there</i>.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n{\\an8}Line one\r\nLine two\r\n\r\n3\r\n00:01:00,250 --> 00:01:02,000\r\nA &amp; B\r\n';
const VTT = 'WEBVTT\n\nNOTE a comment\n\nintro\n00:01.000 --> 00:02.500 align:start line:90%\n<v Bob>Hi</v>\n\n1:00:00.000 --> 1:00:01.000\nHour mark\n';

test('stripTags removes markup and decodes entities', () => {
  assert.equal(stripTags('<i>Hi</i> &amp; <font color="red">bye</font>'), 'Hi & bye');
  assert.equal(stripTags('{\\an8}Top\\Nline'), 'Top\nline');
  assert.equal(stripTags('&#39;ok&#x41;'), "'okA");
});

test('SRT with BOM and CRLF', () => {
  const cues = parseCues(SRT);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { start: 1000, end: 3500, text: 'Hello there.' });
  assert.equal(cues[1].text, 'Line one\nLine two');
  assert.equal(cues[2].start, 60250);
  assert.equal(cues[2].text, 'A & B');
});

test('WebVTT: header, NOTE, identifiers, short timestamps, cue settings', () => {
  const cues = parseCues(VTT);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1000, end: 2500, text: 'Hi' });
  assert.equal(cues[1].start, 3600000);
});

test('cues are sorted and empty cues dropped', () => {
  const cues = parseCues('00:00:05,000 --> 00:00:06,000\nb\n\n00:00:01,000 --> 00:00:02,000\na\n\n00:00:03,000 --> 00:00:04,000\n<i></i>\n');
  assert.deepEqual(cues.map((c) => c.text), ['a', 'b']);
});

test('CueTrack.at: forward playback, jumps back and forth, gaps', () => {
  const t = new CueTrack(parseCues(SRT));
  assert.equal(t.at(0), '');
  assert.equal(t.at(1000), 'Hello there.');
  assert.equal(t.at(3499), 'Hello there.');
  assert.equal(t.at(3500), '');
  assert.equal(t.at(4500), 'Line one\nLine two');
  assert.equal(t.at(61000), 'A & B');
  assert.equal(t.at(1500), 'Hello there.', 'jump back');
  assert.equal(t.at(99999999), '');
  assert.equal(t.at(60250), 'A & B', 'jump back across many cues');
});

test('CueTrack.at: overlapping cues are joined, big file jumps', () => {
  const cues = [];
  for (let i = 0; i < 5000; i++) cues.push({ start: i * 1000, end: i * 1000 + 800, text: 'c' + i });
  cues.push({ start: 2500000, end: 2503000, text: 'long' });
  cues.sort((a, b) => a.start - b.start);
  const t = new CueTrack(cues);
  assert.equal(t.at(4321100), 'c4321');
  assert.equal(t.at(4321900), '', 'gap after a cue');
  assert.equal(t.at(1234000), 'c1234');
  assert.equal(t.at(2501000), 'long\nc2501');
  assert.equal(t.at(2503900), '');
  assert.equal(t.at(10), 'c0');
});

test('empty track', () => {
  assert.equal(new CueTrack([]).at(1000), '');
  assert.deepEqual(parseCues(''), []);
  assert.deepEqual(parseCues('garbage in\nno times'), []);
});


test('line separators survive markup cleanup without splitting inline formatting', () => {
  assert.equal(stripTags('one<br>two<BR />three'), 'one\ntwo\nthree');
  assert.equal(stripTags('<div>one</div><div>two</div>'), 'one\ntwo');
  assert.equal(stripTags('one\\htwo\\nthree'), 'one two\nthree');
  assert.equal(stripTags('some<i>thing</i>, &nbsp;yes'), 'something,  yes');
  const cues = parseCues('00:00:01,000 --> 00:00:03,000\nFirst<br/>second');
  assert.equal(cues[0].text, 'First\nsecond');
});
