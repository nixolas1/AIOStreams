// Server address, device id and sign-in state, persisted in localStorage.
import * as store from './util/store.js';

function randomHex(bytes) {
  let out = '';
  try {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length; i++) out += (buf[i] < 16 ? '0' : '') + buf[i].toString(16);
    return out;
  } catch (e) {
    for (let i = 0; i < bytes; i++) {
      const b = Math.floor(Math.random() * 256);
      out += (b < 16 ? '0' : '') + b.toString(16);
    }
    return out;
  }
}

// Accepts "host:port", "http://host:port", "https://host/path", "/mock/jellyfin".
// Returns '' when unusable. No trailing slash; "/jellyfin" is appended when the
// address has no path.
export function normalizeServerUrl(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return '';
  if (s.charAt(0) === '/') {
    const origin = typeof location !== 'undefined' && location.origin && location.origin !== 'null'
      ? location.origin : 'http://localhost';
    s = origin + s;
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = 'http://' + s;
  }
  let u;
  try { u = new URL(s); } catch (e) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (!u.hostname) return '';
  let path = u.pathname.replace(/\/+$/, '');
  if (!path) path = '/jellyfin';
  return u.origin + path;
}

let state = null;

function load() {
  if (state) return state;
  const saved = store.get('session', null) || {};
  let deviceId = store.get('deviceId', '');
  if (!deviceId) {
    deviceId = randomHex(16);
    store.set('deviceId', deviceId);
  }
  state = {
    base: saved.base || '',
    token: saved.token || '',
    userId: saved.userId || '',
    userName: saved.userName || '',
    deviceId: deviceId,
  };
  return state;
}

function save() {
  const s = load();
  store.set('session', { base: s.base, token: s.token, userId: s.userId, userName: s.userName });
}

// Test hook: forget the in-memory copy so the next call re-reads the store.
export function _reset() { state = null; }

export function getBase() { return load().base; }
export function deviceId() { return load().deviceId; }
export function getToken() { return load().token; }
export function userId() { return load().userId; }
export function userName() { return load().userName; }

// Sets the server (normalized). Changing it drops the sign-in. Returns the
// normalized base, or '' (and changes nothing) when the input is unusable.
export function setBase(input) {
  const base = normalizeServerUrl(input);
  if (!base) return '';
  const s = load();
  if (s.base !== base) {
    s.token = ''; s.userId = ''; s.userName = '';
  }
  s.base = base;
  save();
  return base;
}

export function signIn(info) {
  const s = load();
  s.token = info.token || '';
  s.userId = info.userId || '';
  s.userName = info.userName || '';
  save();
}

export function isSignedIn() {
  const s = load();
  return !!(s.base && s.token && s.userId);
}

// Forgets the account but keeps the server address (prefills Connect).
export function signOut() {
  const s = load();
  s.token = ''; s.userId = ''; s.userName = '';
  save();
}
