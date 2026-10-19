import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapLibrary } from './map.mjs';
import { fetchLibrary, AuthError } from './stremio.mjs';

const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

const MAX_PUSH_BYTES = 64 * 1024;
const TYPES = ['movie', 'series', 'anime'];

export function manifest() {
  return {
    id: 'community.stremio-library-bridge',
    version: VERSION,
    name: 'Stremio Library',
    description: 'Imports your Stremio library as favorites and Continue Watching.',
    types: TYPES,
    catalogs: [],
    resources: [{ name: 'watch_state', types: TYPES }],
    behaviorHints: { configurable: false },
    // Empty push.events would mean every playback event, so name the one that
    // is harmless to receive. watched stays false: a sent `watched` block is a
    // complete set and would sweep rows this bridge cannot see.
    watchState: {
      version: 2,
      push: { events: ['unrated'] },
      pull: {
        items: true,
        watched: false,
        watchlist: true,
        ratings: false,
        ttlSeconds: 300,
      },
    },
  };
}

// Hash first so the compare is constant-time regardless of length.
function tokenMatches(given, expected) {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function createServer(config, deps = {}) {
  const {
    authKey,
    token,
    apiBase = 'https://api.strem.io/api',
    cacheSeconds = 60,
    timeoutMs = 15_000,
    maxItems = 2000,
    maxWatchlist = 5000,
    resumeMaxAgeDays = 120,
  } = config;
  const log = deps.log ?? ((line) => console.log(line));
  const fetchImpl = deps.fetchImpl ?? fetch;

  let cached = null; // { at, payload }
  let inflight = null;

  async function load() {
    if (cached && Date.now() - cached.at < cacheSeconds * 1000) {
      return cached.payload;
    }
    // Concurrent pulls share one upstream call.
    inflight ??= (async () => {
      const started = Date.now();
      try {
        const library = await fetchLibrary({
          apiBase,
          authKey,
          timeoutMs,
          fetchImpl,
        });
        const payload = mapLibrary(library, {
          maxItems,
          maxWatchlist,
          maxAgeMs: resumeMaxAgeDays * 86_400_000,
        });
        cached = { at: Date.now(), payload };
        log(
          `stremio fetch ok library=${library.length} items=${payload.items.length} ` +
            `watchlist=${payload.watchlist.length} ms=${Date.now() - started}`
        );
        return payload;
      } catch (err) {
        log(`stremio fetch failed kind=${err.name} ms=${Date.now() - started}`);
        throw err;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    try {
      if (path === '/health' && req.method === 'GET') {
        return send(res, 200, { ok: true });
      }

      const parts = path.split('/'); // ['', token, ...]
      let given = '';
      try {
        given = decodeURIComponent(parts[1] ?? '');
      } catch {}
      if (!given || !tokenMatches(given, token)) {
        return send(res, 404, { error: 'not found' });
      }
      const rest = '/' + parts.slice(2).join('/');

      if (req.method === 'GET' && rest === '/manifest.json') {
        return send(res, 200, manifest());
      }

      if (req.method === 'GET' && rest === '/watch_state/pull.json') {
        // `since` is ignored: the full payload is cheap and sweeping needs it.
        try {
          return send(res, 200, await load());
        } catch (err) {
          return err instanceof AuthError
            ? send(res, 401, { error: 'stremio auth rejected' })
            : send(res, 502, { error: 'stremio unavailable' });
        }
      }

      if (req.method === 'POST' && rest.startsWith('/watch_state/push/')) {
        // Nothing is written back; read and discard the body, capped.
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_PUSH_BYTES) {
            req.destroy();
            return;
          }
        }
        return send(res, 200, {});
      }

      return send(res, 404, { error: 'not found' });
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    }
  });
}

function configFromEnv(env) {
  for (const name of ['STREMIO_AUTH_KEY', 'BRIDGE_TOKEN']) {
    if (!env[name]) {
      console.error(`Missing required environment variable ${name}`);
      process.exit(1);
    }
  }
  if (env.BRIDGE_TOKEN.length < 16) {
    console.error('BRIDGE_TOKEN must be at least 16 characters');
    process.exit(1);
  }
  return {
    authKey: env.STREMIO_AUTH_KEY,
    token: env.BRIDGE_TOKEN,
    port: Number(env.PORT) || 7010,
    cacheSeconds: env.CACHE_SECONDS ? Number(env.CACHE_SECONDS) : 60,
    // 0 keeps every resume point.
    resumeMaxAgeDays: env.RESUME_MAX_AGE_DAYS
      ? Number(env.RESUME_MAX_AGE_DAYS)
      : 120,
    apiBase: env.STREMIO_API || 'https://api.strem.io/api',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = configFromEnv(process.env);
  createServer(config).listen(config.port, () => {
    console.log(`stremio-library-bridge listening on ${config.port}`);
  });
}
