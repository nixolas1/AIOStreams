# Stremio Library Bridge

A tiny addon that implements only the AIOStreams `watch_state` **pull** protocol.
It reads your Stremio library and hands it to AIOStreams, which imports

- library items as **favorites**, and
- Stremio "Continue Watching" entries as **resume points**.

AIOStreams polls it every 30 minutes and on demand. No dependencies, no build:
plain Node 22 (`node:http` and global `fetch`). The AIOStreams server is not modified.

## Mapping

Mirrors stremio-core.

| Stremio library item | AIOStreams |
| --- | --- |
| `!removed && !temp`, type `movie`/`series`/`anime` | favorite (`kind` is `movie` or `series`, `at` from `_ctime`) |
| type `movie`/`series`/`anime`, `!removed` or `temp`, `state.timeOffset > 0` | resume point |

- Movie resume: `videoId = state.video_id || _id`.
- Series/anime resume needs a `state.video_id` different from `_id`, otherwise skipped.
  Season and episode are left for AIOStreams to parse from the id (`tt1:3:11`, `kitsu:42323:5`).
- `at` is `state.lastWatched`, falling back to `_mtime`. Lists are sorted newest first and capped at 2000 resume points and 5000 favorites.
- `other`, `channel`, `tv` and malformed entries are skipped.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `STREMIO_AUTH_KEY` | | required |
| `BRIDGE_TOKEN` | | required, at least 16 characters; it is the secret URL prefix |
| `PORT` | `7010` | |
| `CACHE_SECONDS` | `60` | in-memory cache of the mapped library |
| `RESUME_MAX_AGE_DAYS` | `120` | Continue Watching entries last played longer ago are dropped; `0` keeps all. Favorites are never aged out |
| `STREMIO_API` | `https://api.strem.io/api` | override for tests |

### Getting the auth key

Sign in at web.stremio.com, open the browser dev console and run:

```js
JSON.parse(localStorage.getItem('profile')).auth.key
```

Treat it like a password. Keep it in an env file with mode 600 and never commit it.
Logging out of Stremio on that session invalidates the key.

## Running

See `compose.example.yaml` for a sidecar on the AIOStreams compose network (no published ports).
Or directly: `STREMIO_AUTH_KEY=... BRIDGE_TOKEN=... node src/server.mjs`.

Routes, all under `/<BRIDGE_TOKEN>/` (anything else is 404): `manifest.json`,
`watch_state/pull.json`, `POST watch_state/push/*` (accepted and ignored).
`GET /health` needs no token.

## Adding it in AIOStreams

Add a custom addon to your profile with the manifest URL
`http://stremio-bridge:7010/<BRIDGE_TOKEN>/manifest.json`
(private URLs are allowed by default). It has no catalogs or streams; it only
provides watch state.

## Limits

- Resume points older than `RESUME_MAX_AGE_DAYS` are left out. Stremio keeps every half-watched title forever, which would flood Continue Watching.
- Only the last watched video per title has a resume point; Stremio keeps no per-episode position.
- No per-episode watched history is imported (that needs decoding Stremio's compressed `state.watched` bitfield).
- Nothing is written back to Stremio.
- A Stremio auth key does not expire on its own; if it is revoked the pull returns 401 and AIOStreams marks the sink as needing re-authentication.

## Tests

`npm test` (uses a glob; Node 24 rejects a bare directory argument)
