// Jellyfin HTTP client: auth header, timeout, one GET retry, typed errors.
import * as session from '../session.js';
import { VERSION } from '../config.js';

const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = null;
// Called once per 401 response (e.g. to drop to the Connect screen).
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export function authorization() {
  const parts = [
    'Client="AIOStreams TV"',
    'Device="Samsung TV"',
    'DeviceId="' + session.deviceId() + '"',
    'Version="' + VERSION + '"',
  ];
  const token = session.getToken();
  if (token) parts.push('Token="' + token + '"');
  return 'MediaBrowser ' + parts.join(', ');
}

// Builds "?a=1&b=2"; skips null/undefined/''; arrays join with ','.
export function queryString(query) {
  if (!query) return '';
  const out = [];
  for (const k in query) {
    let v = query[k];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      v = v.join(',');
    }
    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return out.length ? '?' + out.join('&') : '';
}

export function url(path, query) {
  return session.getBase() + path + queryString(query);
}

async function once(method, path, query, body, keepalive) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : 0;
  const headers = { Authorization: authorization() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url(path, query), {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      keepalive: keepalive || undefined,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const msg = (data && (data.Message || data.message)) || 'HTTP ' + res.status;
    throw new ApiError(res.status, msg, data);
  }
  return data;
}

async function request(method, path, query, body, opts) {
  try {
    return await once(method, path, query, body, opts && opts.keepalive);
  } catch (e) {
    // Network failure or timeout (not an HTTP status): GET retries once.
    if (method === 'GET' && !(e instanceof ApiError)) {
      return once(method, path, query, body);
    }
    if (!(e instanceof ApiError)) {
      const err = new ApiError(0, e && e.name === 'AbortError' ? 'Timed out' : "Can't reach the server");
      throw err;
    }
    throw e;
  }
}

export function get(path, query) { return request('GET', path, query); }
export function post(path, body, query, opts) { return request('POST', path, query, body, opts); }
export function del(path, query) { return request('DELETE', path, query); }

// Image URL. type: Primary | Backdrop | Logo | Thumb ...; fillWidth lets the
// server snap to TMDB widths.
export function imageUrl(itemId, type, o) {
  o = o || {};
  const path = '/Items/' + itemId + '/Images/' + type + (o.index != null ? '/' + o.index : '');
  return url(path, { fillWidth: o.width, quality: 85, tag: o.tag });
}

// Mirrors packages/web/src/lib/playback/stream.ts: the server's stream route,
// token in the query since a player cannot send the header.
export function streamUrl(itemId, source, playSessionId) {
  return url('/Videos/' + itemId + '/stream', {
    static: true,
    MediaSourceId: source.Id,
    PlaySessionId: playSessionId,
    ApiKey: session.getToken(),
  });
}

// The source's own address when it is http(s), else the stream route.
export function directUrl(itemId, source, playSessionId) {
  return source.Path && /^https?:\/\//i.test(source.Path)
    ? source.Path
    : streamUrl(itemId, source, playSessionId);
}
