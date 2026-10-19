# Module contracts (phase 1)

Everything here exists and is tested unless marked (stub). Chrome 76 rules apply
(see AGENTS.md). All paths are under `app/js/`.

## Screen object

```js
{ el, name, onKey(action) -> bool, onShow?(), onHide?(), destroy?() }
```

- `el`: a `div.screen` (absolute, 1920x1080). Give it `dataset.screen = name`.
- `onKey` returns `true` if it consumed the key. Returning false/undefined lets
  the router's global handler run; an unhandled `back` pops the screen.
- `onShow`/`onHide` fire on push, on revealing after a pop above it, and on hide.
  `destroy` fires on pop/replace/reset (after `onHide`). Hidden screens stay
  mounted with `display:none`, so keep focus state on the screen object.
- Factories: `XScreen(args)` in `screens/x.js`, args per nav name below.

## Key actions (`platform/tizen.js` KEYMAP -> `input.js` -> `screen.onKey`)

`left right up down enter back playpause play pause stop ff rw pageup pagedown
red green yellow blue info imedone imecancel`. left/right/up/down are coalesced
to one per animation frame; holding sets `html.fast` (`input.isFast()`).
A focused `<input>` only forwards `back up down enter imedone imecancel`.
Desktop: arrows, Enter, Esc/Backspace=back, Space=playpause, PageUp/PageDown.
`input.inject(action)` feeds an action programmatically.

## Modules

- `config.js`: `VERSION`, `DEV` (rewritten by build; DEV=false in the .wgt).
- `main.js` -> `app.js`: `start()`. DEV: `?server=<url>` sets the server.
- `router.js`: `init(container, onGlobalKey)`, `push(screen)`, `replace(screen)`,
  `reset(screen)`, `back()`, `top()`, `depth()`, `setRootBack(fn -> bool)`.
  Back on the root screen calls the root hook; if it does not return true the app exits.
- `input.js`: `setHandler(fn)`, `inject(action)`, `isFast()`, `stats`.
- `platform/tizen.js`: `KEYMAP`, `actionFor(e)`, `registerKeys()`, `exitApp()`,
  `setScreenSaver(on)`, `isUhdPanel()`, `isTizen()` (all safe on desktop).
- `nav.js`: `register(name, fn)`, `go(name, ...args)`, `has(name)`. Names (registered in `app.js`):
  `openItem(item)` -> Detail, `playItem(item, opts)` -> Player, `openLibrary(view, opts)` -> Library,
  `openHub(kind)` -> Hub (`'movies'|'series'|'anime'`), `openSearch()`, `openSettings()`,
  `openSources(item)`, `openConnect()` (resets the stack to Connect).
  Screens receive `{item}`, `{item, opts}`, `{view, opts}`, `{kind}`, `{}`, `{}`, `{item}`, `{}`.
- `session.js`: `normalizeServerUrl(s)`, `getBase()`, `setBase(s)` (normalizes; changing server drops
  sign-in; returns '' if unusable), `deviceId()`, `getToken()`, `userId()`, `userName()`,
  `signIn({token,userId,userName})`, `signOut()` (keeps server), `isSignedIn()`.
  Persisted in `atv.session` / `atv.deviceId`.
- `util/dom.js`: `h(tag, attrs|className, children)` (attrs: `class,id,text,style{},dataset{}`, others set as attributes),
  `setText(el,v)`, `setTransform(el,v)`, `setStyle(el,prop,v)`, `show(el,bool)`, `toggleClass(el,name,on)`
  (all skip no-op writes).
- `util/store.js`: `get(key, fallback)`, `set(key, value)` (undefined removes; returns bool), `remove(key)`. Prefix `atv.`.
- `util/format.js` (Jellyfin BaseItemDto; ticks are 100 ns): `duration(ticks)` "1h 46m", `clock(ms)` "1:02:03",
  `endsAt(remainingMs[, now])` "21:42", `episodeLabel(item)` "S1 · E2", `metaLine(item)`
  "2008  ·  PG-13  ·  1h 46m  ·  ★ 5.8" (series: "N seasons"), `progressFraction(item)` 0..1 from UserData.
- `util/time.js`: `sleep(ms)`, `debounce(fn, ms)` (+`.cancel()`).

## API

- `api/client.js`: `get(path, query)`, `post(path, body, query, {keepalive})`, `del(path, query)` -> parsed JSON
  or null (204). Skips null/''/undefined query values; arrays join with ','. 15 s timeout, GET retries once on
  network error, throws `ApiError{status,message,body}` (status 0 = unreachable/timeout).
  `setUnauthorizedHandler(fn)` (called on 401), `authorization()`, `url(path, query)`, `queryString(q)`,
  `imageUrl(id, type, {width, tag, index})`, `streamUrl(id, source, playSessionId)`,
  `directUrl(id, source, playSessionId)` (source.Path when http(s), else stream route).
- `api/jellyfin.js` (list calls resolve to `{Items, TotalRecordCount[, StartIndex]}`; `latest` is wrapped to match):
  `FIELDS`, `FIELDS_DETAIL`; `quickConnectInitiate()`, `quickConnectState(secret)` (`.Authenticated`),
  `authenticateQuickConnect(secret)` -> `{AccessToken, User:{Id,Name}}` (caller does `session.signIn`),
  `me()`, `views()`, `resume({limit,parentId})`, `nextUp({limit,seriesId})`, `upcoming({limit})`,
  `latest({parentId,limit,includeItemTypes})`,
  `items({parentId,startIndex,limit,sortBy,sortOrder,genres,genreIds,minPremiereDate,searchTerm,includeItemTypes,filters,recursive})`,
  `genres(parentId)`, `item(id)`, `seasons(seriesId)`, `episodes(seriesId, seasonId)`, `similar(id, limit)`,
  `searchHints(term)` -> `{SearchHints}`, `playbackInfo(id, {startTimeTicks, sourceId, refresh, kept})`
  -> `{MediaSources, PlaySessionId}` (each source's `Id` is `aiostreams.id` when present),
  `reportStart/Progress/Stopped(payload)`, `markPlayed(id, bool)`, `setFavorite(id, bool)`, `favorites({limit})`.
- Real server facts: `CollectionType` is `movies | tvshows | boxsets` (never "anime"; anime is a tvshows view
  recognised by name). `Resume`/`NextUp`/`Upcoming` return empty when `ParentId` is given. `Genres` takes the
  genre name (first one is used). `Recursive=true` is the default in `items()`.

## CSS classes (`css/app.css`)

Tokens on `:root`: `--bg --raised --accent --text --dim --faint --ease --display --body`.
Layout: `.screen .hidden .ambience`. Focus: `.ring` (+`.on`), `.btn`/`.btn.focus` (cream invert), `.pill`/`.pill.current|.focus`,
`.chip`/`.chip.focus`. Nav: `.topbar .brand .brand-mark .brand-word .nav .nav-item(.current|.focus) .nav-sep .topbar-who .nav-track`.
Rows: `.rows-track .row(.active|.above) .row-title .row-clip .row-track`. Grid: `.grid .grid-track .grid-row`.
Tiles: `.tile` + kind `.tile-wide` (400x225) | `.tile-poster` (220x330) | `.tile-episode` (384x216) | `.tile-grid` (216x324);
inside: `.tile-frame > img.tile-img(.in|.now) + .tile-ph(placeholder title) + .tile-bar>i + .tile-badge(.done)`, then
`.tile-cap`, `.tile-sub`. Root classes: `html.fast` (shortened transitions), `html.playing` (transparent; video plane below).
Hero/detail art, hero text, OSD, detail layout and settings styles are added by the owning phase in its own section of `app.css`
(append; do not reorder existing rules).

## Dev/test tooling

`npm run dev` (static app + mock Jellyfin at `/mock/jellyfin`), open `http://localhost:8790/?server=/mock/jellyfin`
(sign in via Quick Connect; it auto-approves after 2 polls) or `?server=<real /jellyfin>`.
Mock fixtures: `tests/fixtures/*.json` (regenerate with `node tests/fixtures/generate.mjs`).
Mock ids: views `view-trending-movies`, `view-popular-series`, `view-netflix-movies`, `view-anime-kitsu-trending`,
`view-top-rated-movies`, `view-new-anime`; items `mov…`/`ser…`/`ani…`; `ep-<seriesId>-s1e2`; `se-<seriesId>-1`.

## File ownership for phase 2

- A: `ui/{tile,row,grid,images,backdrop,chips,toast}.js`, `screens/{home,hub,library}.js`, `api/hubs.js`
- B: `screens/{detail,sources,player}.js`, `platform/player.js`, `player/subtitles.js`
- C: `screens/{connect,search,settings}.js`, `ui/keyboard.js`, `vendor/qrcode.js`
- Shared and frozen (change only by agreement): `router.js input.js nav.js session.js app.js util/* api/client.js api/jellyfin.js`.
  `css/app.css`: append a clearly marked section per owner. `app.js`: only swap in the real nav handlers if needed.
- Placeholders exist for every file above (screens return `placeholder(name)`; ui/api/platform stubs `export {}`).
  Replace them wholesale; delete the `_placeholder.js` import when done.
- Add `tests/<module>.test.mjs` for logic; browser checks extend `tests/browser/smoke.mjs`.
