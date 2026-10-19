import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createServer } from '../src/server.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/library.json', import.meta.url), 'utf8')
);
const TOKEN = 'test-token-0123456789';
const AUTH_KEY = 'synthetic-auth-key';

let stub, stubPort, mode, hits, logs;
const servers = [];

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  );
}

async function bridge(overrides = {}) {
  const server = createServer(
    {
      authKey: AUTH_KEY,
      token: TOKEN,
      apiBase: `http://127.0.0.1:${stubPort}/api`,
      cacheSeconds: 60,
      // The fixture dates from 2024; ageing is covered in map.test.mjs.
      resumeMaxAgeDays: 0,
      ...overrides,
    },
    { log: (l) => logs.push(l) }
  );
  servers.push(server);
  const port = await listen(server);
  return (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);
}

before(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits++;
      const parsed = JSON.parse(body);
      assert.equal(req.url, '/api/datastoreGet');
      assert.equal(parsed.authKey, AUTH_KEY);
      assert.equal(parsed.collection, 'libraryItem');
      res.setHeader('content-type', 'application/json');
      if (mode === 'auth') {
        res.end(JSON.stringify({ error: { message: 'Session does not exist', code: 1 } }));
      } else if (mode === '500') {
        res.statusCode = 500;
        res.end('{}');
      } else {
        res.end(JSON.stringify({ result: fixture }));
      }
    });
  });
  stubPort = await listen(stub);
});

after(() => {
  stub.close();
  for (const s of servers) s.close();
});

function reset() {
  mode = 'ok';
  hits = 0;
  logs = [];
}

test('wrong or missing token is 404, health needs none', async () => {
  reset();
  const get = await bridge();
  assert.equal((await get('/wrong/manifest.json')).status, 404);
  assert.equal((await get('/manifest.json')).status, 404);
  assert.equal((await get('/')).status, 404);
  const health = await get('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
});

test('manifest declares a pull-only capability the server accepts', async () => {
  reset();
  const get = await bridge();
  const res = await get(`/${TOKEN}/manifest.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const m = await res.json();
  assert.deepEqual(m.resources, [
    { name: 'watch_state', types: ['movie', 'series', 'anime'] },
  ]);
  assert.equal(m.watchState.pull.watched, false);
  assert.equal(m.watchState.pull.watchlist, true);
  assert.notEqual(m.watchState.pull.items, false);
  // empty events would fall back to every playback event
  assert.ok(m.watchState.push.events.length > 0);
  assert.ok(!m.watchState.push.events.includes('start'));
});

test('pull returns mapped items and watchlist, ignoring since', async () => {
  reset();
  const get = await bridge();
  const res = await get(`/${TOKEN}/watch_state/pull.json?since=abc`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['items', 'watchlist']);
  assert.ok(body.items.some((i) => i.videoId === 'tt0903747:3:11'));
  assert.ok(body.watchlist.some((w) => w.metaId === 'tt0111161'));
});

test('pull is cached and concurrent pulls share one fetch', async () => {
  reset();
  const get = await bridge();
  await Promise.all([1, 2, 3].map(() => get(`/${TOKEN}/watch_state/pull.json`)));
  await get(`/${TOKEN}/watch_state/pull.json`);
  assert.equal(hits, 1);
});

test('cacheSeconds 0 refetches', async () => {
  reset();
  const get = await bridge({ cacheSeconds: 0 });
  await get(`/${TOKEN}/watch_state/pull.json`);
  await get(`/${TOKEN}/watch_state/pull.json`);
  assert.equal(hits, 2);
});

test('stremio auth error is 401', async () => {
  reset();
  mode = 'auth';
  const get = await bridge();
  assert.equal((await get(`/${TOKEN}/watch_state/pull.json`)).status, 401);
});

test('stremio 500 is 502', async () => {
  reset();
  mode = '500';
  const get = await bridge();
  assert.equal((await get(`/${TOKEN}/watch_state/pull.json`)).status, 502);
});

test('unreachable stremio is 502', async () => {
  reset();
  const get = await bridge({ apiBase: 'http://127.0.0.1:1/api' });
  assert.equal((await get(`/${TOKEN}/watch_state/pull.json`)).status, 502);
});

test('push is accepted and discarded', async () => {
  reset();
  const get = await bridge();
  const res = await get(
    `/${TOKEN}/watch_state/push/movie/tt0111161.json`,
    { method: 'POST', body: '{"event":"unrated"}' }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {});
  assert.equal(hits, 0);
});

test('logs never contain the auth key, token or titles', async () => {
  reset();
  const get = await bridge();
  await get(`/${TOKEN}/watch_state/pull.json`);
  assert.ok(logs.length > 0);
  const all = logs.join('\n');
  for (const secret of [AUTH_KEY, TOKEN, 'Movie Resume']) {
    assert.ok(!all.includes(secret));
  }
});
