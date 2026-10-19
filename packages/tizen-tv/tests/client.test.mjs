import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';

globalThis.localStorage = fakeStorage();
const session = await import('../app/js/session.js');
const client = await import('../app/js/api/client.js');

session.setBase('h:1');
session.signIn({ token: 'tok', userId: 'u', userName: 'N' });

test('queryString skips empties and joins arrays', () => {
  assert.equal(client.queryString({ a: 1, b: '', c: undefined, d: null, e: ['x', 'y'], f: [], g: false }), '?a=1&e=x%2Cy&g=false');
  assert.equal(client.queryString({}), '');
});

test('authorization header', () => {
  const a = client.authorization();
  assert.match(a, /^MediaBrowser Client="AIOStreams TV", Device="Samsung TV", DeviceId="[0-9a-f]{32}", Version="[^"]+", Token="tok"$/);
});

test('imageUrl', () => {
  assert.equal(client.imageUrl('i1', 'Primary', { width: 220, tag: 't' }), 'http://h:1/jellyfin/Items/i1/Images/Primary?fillWidth=220&quality=85&tag=t');
  assert.equal(client.imageUrl('i1', 'Backdrop', { index: 0 }), 'http://h:1/jellyfin/Items/i1/Images/Backdrop/0?quality=85');
});

test('streamUrl / directUrl mirror the web client', () => {
  const s = client.streamUrl('i1', { Id: 'src' }, 'ps');
  assert.equal(s, 'http://h:1/jellyfin/Videos/i1/stream?static=true&MediaSourceId=src&PlaySessionId=ps&ApiKey=tok');
  assert.equal(client.directUrl('i1', { Id: 'src', Path: 'https://cdn/x.mkv' }), 'https://cdn/x.mkv');
  assert.equal(client.directUrl('i1', { Id: 'src', Path: '/local/x.mkv' }), 'http://h:1/jellyfin/Videos/i1/stream?static=true&MediaSourceId=src&ApiKey=tok');
});
