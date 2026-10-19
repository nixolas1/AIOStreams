import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';

globalThis.localStorage = fakeStorage();
const session = await import('../app/js/session.js');
const n = session.normalizeServerUrl;

test('normalizeServerUrl: host:port and full URLs', () => {
  assert.equal(n('192.168.1.5:3000'), 'http://192.168.1.5:3000/jellyfin');
  assert.equal(n('localhost:3000'), 'http://localhost:3000/jellyfin');
  assert.equal(n('  http://host:3000/  '), 'http://host:3000/jellyfin');
  assert.equal(n('https://aio.example.com'), 'https://aio.example.com/jellyfin');
  assert.equal(n('https://aio.example.com/'), 'https://aio.example.com/jellyfin');
});

test('normalizeServerUrl: keeps an existing path, strips trailing slash', () => {
  assert.equal(n('http://h:1/jellyfin/'), 'http://h:1/jellyfin');
  assert.equal(n('http://h:1/media/jf'), 'http://h:1/media/jf');
  assert.equal(n('/mock/jellyfin'), 'http://localhost/mock/jellyfin');
});

test('normalizeServerUrl: rejects junk', () => {
  assert.equal(n(''), '');
  assert.equal(n('   '), '');
  assert.equal(n(null), '');
  assert.equal(n('ftp://host'), '');
  assert.equal(n('http://'), '');
});

test('session persists and signOut keeps the server', () => {
  assert.equal(session.isSignedIn(), false);
  assert.equal(session.setBase('10.0.0.2:8080'), 'http://10.0.0.2:8080/jellyfin');
  assert.equal(session.setBase('ftp://x'), '');
  assert.equal(session.getBase(), 'http://10.0.0.2:8080/jellyfin');
  const id = session.deviceId();
  assert.match(id, /^[0-9a-f]{32}$/);
  session.signIn({ token: 't', userId: 'u', userName: 'Nick' });
  assert.equal(session.isSignedIn(), true);
  session._reset();
  assert.equal(session.isSignedIn(), true, 'restored from storage');
  assert.equal(session.userName(), 'Nick');
  assert.equal(session.deviceId(), id, 'device id persisted');
  session.signOut();
  assert.equal(session.isSignedIn(), false);
  assert.equal(session.getBase(), 'http://10.0.0.2:8080/jellyfin');
});

test('changing the server drops the sign-in', () => {
  session.signIn({ token: 't', userId: 'u', userName: 'Nick' });
  session.setBase('other:1');
  assert.equal(session.isSignedIn(), false);
});
