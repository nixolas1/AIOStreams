import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, openYouTube } from '../app/js/platform/youtube.js';

test('youtubeId parses the common url shapes', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(youtubeId('https://www.youtube.com/watch?v=' + id), id);
  assert.equal(youtubeId('https://m.youtube.com/watch?feature=share&v=' + id + '&t=42'), id);
  assert.equal(youtubeId('https://youtu.be/' + id + '?t=10'), id);
  assert.equal(youtubeId('https://www.youtube.com/embed/' + id), id);
  assert.equal(youtubeId('http://youtube.com/watch?v=' + id + '#t=1'), id);
});

test('youtubeId rejects non-youtube and malformed urls', () => {
  assert.equal(youtubeId(''), '');
  assert.equal(youtubeId(undefined), '');
  assert.equal(youtubeId('https://vimeo.com/12345678'), '');
  assert.equal(youtubeId('https://www.youtube.com/watch'), '');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=a b'), '');
  assert.equal(youtubeId('https://evil.com/youtu.be/dQw4w9WgXcQ'), '');
});

function withGlobals(fetchImpl, tizen, fn) {
  const f = globalThis.fetch;
  const w = globalThis.window;
  globalThis.fetch = fetchImpl;
  globalThis.window = { tizen: tizen };
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = f; globalThis.window = w; });
}

function fakeTizen(ok, calls) {
  return {
    ApplicationControl: function (op, uri, mime, cat, data) { this.data = data; },
    ApplicationControlData: function (k, v) { this.key = k; this.value = v; },
    application: {
      launchAppControl(ctl, app, onOk, onErr) { calls.push({ ctl, app }); if (ok) onOk(); else onErr(new Error('x')); },
    },
  };
}

test('openYouTube posts to DIAL first', async () => {
  const seen = [];
  const calls = [];
  const r = await withGlobals(
    (url, o) => { seen.push({ url, o }); return Promise.resolve({}); },
    fakeTizen(true, calls),
    () => openYouTube('dQw4w9WgXcQ')
  );
  assert.equal(r, 'dial');
  assert.equal(seen[0].o.body, 'v=dQw4w9WgXcQ');
  assert.equal(seen[0].o.mode, 'no-cors');
  assert.equal(calls.length, 0);
});

test('openYouTube falls back to the app control payload', async () => {
  const calls = [];
  const r = await withGlobals(
    () => Promise.reject(new Error('net')),
    fakeTizen(true, calls),
    () => openYouTube('dQw4w9WgXcQ')
  );
  assert.equal(r, 'appcontrol');
  assert.equal(calls[0].app, '111299001912');
  assert.equal(calls[0].ctl.data[0].key, 'PAYLOAD');
  assert.equal(calls[0].ctl.data[0].value[0], '{"values":"v=dQw4w9WgXcQ"}');
});

test('openYouTube rejects when both paths fail (no tizen)', async () => {
  await withGlobals(() => Promise.reject(new Error('net')), undefined, async () => {
    await assert.rejects(openYouTube('dQw4w9WgXcQ'));
  });
});
