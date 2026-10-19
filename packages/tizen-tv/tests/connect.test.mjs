import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';

// connect.js pulls in router/input (document listeners) at import time.
globalThis.localStorage = fakeStorage();
globalThis.document = {
  addEventListener() {}, activeElement: null,
  documentElement: { classList: { contains: () => false, toggle() {} } },
};
globalThis.window = globalThis.window || { addEventListener() {} };

const connect = await import('../app/js/screens/connect.js');
const search = await import('../app/js/screens/search.js');
const { default: qrcode } = await import('../app/js/vendor/qrcode.js');

test('parseServerInput accepts the usual spellings', () => {
  assert.equal(connect.parseServerInput('192.168.1.5:3000'), 'http://192.168.1.5:3000/jellyfin');
  assert.equal(connect.parseServerInput('http://h:3000'), 'http://h:3000/jellyfin');
  assert.equal(connect.parseServerInput('http://h:3000/jellyfin/'), 'http://h:3000/jellyfin');
  assert.equal(connect.parseServerInput('h:3000/jellyfin'), 'http://h:3000/jellyfin');
  assert.equal(connect.parseServerInput(''), '');
  assert.equal(connect.parseServerInput('ftp://x'), '');
});

test('webAddress and hostOf', () => {
  assert.equal(connect.webAddress('http://h:3000/jellyfin'), 'http://h:3000/');
  assert.equal(connect.hostOf('http://h:3000/jellyfin'), 'h:3000');
  assert.equal(connect.webAddress('nope'), '');
});

const resp = (status, body) => ({ ok: status < 300, status, json: async () => body });

test('validateServer: ok, not-json, http error, network error, timeout', async () => {
  let seen = '';
  const ok = await connect.validateServer('http://h/jellyfin', async (u) => { seen = u; return resp(200, { ServerName: 'Mine', Id: 'x' }); });
  assert.deepEqual(ok, { ok: true, name: 'Mine' });
  assert.equal(seen, 'http://h/jellyfin/System/Info/Public');
  assert.equal((await connect.validateServer('http://h/jellyfin', async () => resp(200, { nope: 1 }))).ok, false);
  assert.equal((await connect.validateServer('http://h/jellyfin', async () => resp(404, {}))).ok, false);
  assert.equal((await connect.validateServer('http://h/jellyfin', async () => { throw new Error('x'); })).ok, false);
  const t0 = Date.now();
  const slow = await connect.validateServer('http://h/jellyfin', () => new Promise(() => {}), 50);
  assert.equal(slow.ok, false);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal((await connect.validateServer('', async () => resp(200, {}))).ok, false);
});

test('qrcode wrapper produces a square matrix', () => {
  const qr = qrcode(0, 'M');
  qr.addData('http://192.168.1.20:3000/');
  qr.make();
  const n = qr.getModuleCount();
  assert.ok(n >= 21 && (n - 17) % 4 === 0);
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++;
  assert.ok(dark > n * 2);
});

test('search grouping and recents', () => {
  const items = [
    { Id: 'a', Type: 'Movie', Genres: ['Drama'] },
    { Id: 'b', Type: 'Series', Genres: ['Drama'] },
    { Id: 'c', Type: 'Series', Genres: ['Anime'] },
    { Id: 'd', Type: 'Series', Genres: ['Animation'], ProviderIds: { Kitsu: '1' } },
    { Id: 'e', Type: 'Series', Genres: ['Animation'], ProviderIds: { Tmdb: '1' } },
  ];
  const g = search.groupResults(items);
  assert.deepEqual(g.map((x) => x.title + ':' + x.items.map((i) => i.Id).join('')), ['Movies:a', 'Series:be', 'Anime:cd']);
  assert.equal(search.groupResults([{ Id: 'z', Type: 'Movie' }], () => true)[0].title, 'Anime');
  let r = [];
  for (let i = 0; i < 12; i++) r = search.addRecent(r, 'term' + i);
  assert.equal(r.length, 8);
  assert.equal(r[0], 'term11');
  assert.deepEqual(search.addRecent(['b', 'AB'], 'ab'), ['ab', 'b']);
  assert.deepEqual(search.addRecent(['b'], 'x'), ['b']); // too short
});
