# AIOStreams TV (Tizen 6, Chrome 76)

A small framework-free client for the AIOStreams server's Jellyfin API, written for Samsung Tizen 6+ TVs
(1920x1080 fixed canvas, native ES modules, no bundler, no runtime dependencies). Architecture adapted from
[samsucks](https://github.com/rfaile313/samsucks) (see `NOTICE`). It installs side by side with the patched
web app (own app ID `AIOTV00001.AIOStreamsTV`).

## Dev loop (desktop Chrome)

```sh
npm run dev          # http://localhost:8790/?server=/mock/jellyfin
npm run check        # ES2019 parse + banned API/CSS lint of app/
npm test             # node --test tests/*.test.mjs
npm run test:browser # Playwright smoke test (skips when Playwright/Chromium are not cached)
```

Open `http://localhost:8790/?server=/mock/jellyfin` for the mock server; any server works the same way
(`?server=http://host:port`, the `/jellyfin` suffix is added, and the server must allow CORS from the dev origin).
The window is zoomed to fit; arrow keys, Enter, Esc/Backspace (Back), Space (play/pause) emulate the remote.
The error overlay at the bottom of the screen prints uncaught errors (a TV has no console).

The smoke test finds Playwright in `PLAYWRIGHT_PATH`, `./node_modules`, or `~/.npm/_npx/*/node_modules/playwright`
(`npm i` cannot run in this folder inside the pnpm workspace), and Chromium in `PLAYWRIGHT_CHROMIUM` or the
Playwright browser cache.

## Build

```sh
node scripts/build.mjs   # app/ -> build/app (config stamped, modulepreload injected) -> out/AIOStreamsTV.wgt
```

The `.wgt` is an unsigned, deterministic zip with `config.xml` at its root; `scripts/check-legacy.mjs` runs on the
result. Signing happens at install time.

## Install on the TV

Ask the TV owner first (every install is an interruption). From the workspace root, with Apps2Samsung closed:

```sh
./tvctl doctor
./tvctl install /abs/path/to/vendor/AIOStreams/packages/tizen-tv/out/AIOStreamsTV.wgt --sign --launch
```

Install is verified by the CLI; launch and visuals must be confirmed on the TV. Never uninstall to work around errors.

## Constraints (Chrome 76)

JS: no `?.`, `??`, `||=`/`&&=`/`??=`, `#private` fields, static blocks, top-level await, `.at()`, `replaceAll`,
numeric separators (also `findLast`, `toSorted`, `structuredClone`, `Promise.any`). CSS: no flex/grid `gap`,
`aspect-ratio`, `inset`, `:focus-visible`, `content-visibility`, `max()/min()/clamp()`, `backdrop-filter`, `:is/:where/:has`;
animate only `transform`/`opacity`. `check-legacy.mjs` enforces all of this. Module contracts: `CONTRACTS.md`.

### In-app YouTube trailers

Serve `hosted/tv-trailer.html` at `/static/tv-trailer.html` on the Jellyfin
server origin. The workspace Compose file mounts it into the AIOStreams server
static directory. It contains no credentials and receives only the YouTube video
ID in its URL fragment. An HTTP page is required so YouTube receives a web
referrer; a direct embed in a packaged Tizen file can fail with error 153.
The TV app retains remote focus: OK toggles playback, Left/Right seek ten
seconds, and Back closes and destroys the player. Restricted videos show an
error. Browser tests mock YouTube to verify controls and cleanup; actual YouTube
playback and codec compatibility must be checked on the TV.

### Norwegian shows (2026-10-23)

Home and Series show **Norske serier**, replacing the regional-availability row.
The approved default is Norwegian original-language shows with episodes aired this
calendar year, excluding news, ranked by current TMDB popularity. This is not a
measured annual/monthly viewing chart. Reality and entertainment stay included.

Settings → Norwegian shows:
- Show Norske serier: On / Off.
- Episodes aired: This year / This month / All time (Norwegian calendar dates).
- Category: All / Drama & crime / Comedy / Reality & entertainment / Documentary.
- Broadcaster: All / NRK / TV 2 / HBO & Max / TVNorge / TV3 & Viaplay / Netflix.
- Include news: Off by default.

Left/right changes choices; OK advances or toggles. Preferences persist on-device,
refresh on Back without restarting, and appear in the row heading. A prior explicit
Off is preserved; an old country choice otherwise becomes Norwegian discovery.
Old availability caches are discarded. Filters and date changes have distinct cache
identities. Empty results hide the row; they never substitute unrelated shows.

`GET /Discover/NorwegianShows?Period=year&Category=all&Source=all&IncludeNews=false`
is an authenticated Jellyfin extension. Invalid filters return 400; missing TMDB
credentials return 503. Existing user/server credentials stay server-side. The
old `/Discover/RegionalShows` route is retained for already-installed clients.

The server queries TMDB Discover separately for `no`, `nb`, and `nn`, merges their
first 20 results, deduplicates by TMDB ID, and ranks the combined top 20. Results are
cached for one hour by query/date, then mapped to IDs supported by the user's meta
addons. A failing language request fails the row rather than caching a partial list.

Period means **episodes aired** (`air_date.gte/lte`), not the show's first premiere,
so returning seasons remain eligible. Broadcaster uses `with_networks` with verified
network ID groups, not `watch_region` or current streaming subscriptions. TMDB's
network and episode metadata can be incomplete, particularly for smaller shows.

Research: [Discover TV](https://developer.themoviedb.org/reference/discover-tv),
[popularity methodology](https://developer.themoviedb.org/docs/popularity-and-trending).
On 2026-10-23 the live default query returned the user-approved mix including Alle
mot alle, Paradise Hotel, Nytt på nytt, Harry Hole, Kongen befaler, LIS and Nepobaby.

Deployment requires both the server extension and widget update. Validate with the
TV legacy check/unit tests/Chromium smoke, core/server TypeScript builds, and focused
Norwegian discovery tests. Browser fixtures remain synthetic. Physical TV rendering
is a separate check, and each TV install requires the owner's explicit approval.
