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
red green yellow blue info imedone imecancel longenter`. left/right/up/down are coalesced
to one per animation frame; holding sets `html.fast` (`input.isFast()`).
A focused `<input>` only forwards `back up down enter imedone imecancel`.
Backspace (keyCode 8, including the Samsung IME Delete key) keeps its native text-editing
behavior while an input is focused; remote Return (10009) and Escape still cancel editing.
Desktop: arrows, Enter, Esc/Backspace=back, Space=playpause, PageUp/PageDown.
`input.inject(action)` feeds an action programmatically.
OK outside a text field acts on release: `enter` on keyup, or `longenter` once it has been held ~450 ms (the
following keyup is swallowed; auto-repeat keydowns are ignored; `util/longpress.js`). In a focused `<input>`, OK still
dispatches `enter` immediately on keydown. `longenter` only reaches screens that set `longEnter: true` (the browse
pages); `router.js` turns it into `enter` for every other screen and when the screen's `onKey('longenter')` does
not return true, so a long press never feels broken elsewhere.

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
  `openItem(item, {from}?)` -> Detail, `playItem(item, opts)` -> Player, `openLibrary(view, opts)` -> Library,
  `openHub(kind, {focusNav}?)` -> Hub (`'movies'|'series'|'anime'`), `openSearch()`, `openSettings()`,
  `openSources(item)`, `openConnect()` (resets the stack to Connect).
  Screens receive `{item, from}`, `{item, opts}`, `{view, opts}`, `{kind}`, `{}`, `{}`, `{item}`, `{}`.
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
  "2008  ·  1h 46m  ·  PG-13  ·  ★ 5.8" (series: "N seasons"), `progressFraction(item)` 0..1 from UserData.
- `util/time.js`: `sleep(ms)`, `debounce(fn, ms)` (+`.cancel()`).
- `util/longpress.js`: `createLongPress(fire, {ms, now})` -> `{down(repeat), up(), cancel(), pressed()}`; `LONG_MS = 450`.

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
  `reportStart/Progress/Stopped(payload)`, `markPlayed(id, bool)`, `setFavorite(id, bool)`, `favorites({limit})`,
  `clearResume(id)` (POST UserData `{PlaybackPositionTicks: 0}`: leaves Continue watching), `dropSeries(seriesId)` /
  `undropSeries(seriesId)` (POST / DELETE `/UserItems/{id}/Rating`, `Likes=false`: leaves / rejoins Next up).
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

## UI kit (phase 2, agent A)

Chrome 76 rules apply. Images always go through `ui/images.js`; all tiles through `ui/tile.js`.

- `ui/images.js`: `load(img, url, {now})` sets `img._want`, queues the job (max 6 concurrent, LIFO, stale jobs dropped),
  decodes, then attaches and adds class `in` (fade; `now` class when attached instantly from the 800-entry LRU or `{now:true}`).
  `load(img, '')` clears. `cancel(img)` drops a pending job. `prefetch(url)` warms the cache.
- `ui/tile.js`: `KINDS = {wide:{w:400,h:225}, poster:{w:220,h:330}, episode:{w:384,h:216,caption:true}, grid:{w:216,h:324,caption:true}}`,
  `CAPTION_H = 70`. `createTile(kind, {kindBadge})` -> element (`.tile.tile-<kind>`, absolutely positioned: set `transform: translateX/Y`;
  state lives on `el._t`). `fillTile(tile, item, kind?)` exits early when it already shows `item`; picks art (wide: Thumb/Backdrop,
  episodes: Primary, falling back to the series' backdrop/primary; poster/grid: Primary), a placeholder title, a progress bar from
  `UserData.PlayedPercentage`, a badge (unplayed count on series, check when played) and optional kind label.
  `imageFor(item, 'Primary'|'Thumb'|'Backdrop'|'Logo', width)` -> URL or '' (use it for hero/detail art and logos; it handles
  episode -> series fallbacks via `SeriesId`, `ParentBackdropItemId/ImageTags`, `ParentLogoItemId/ImageTag`, `SeriesPrimaryImageTag`).
  Needs the item's `ImageTags`/`BackdropImageTags` (they are in `jellyfin.FIELDS`).
- `ui/row.js`: `createRow({kind, title, onFocus(item,index), onSelect(item,index), onNeedMore(), kindBadge})` ->
  `{el, height, setItems(items), appendItems(items), move(dx) -> bool, setIndex(i) (silent), index(), item(), items(), count(),
  select(), setTitle(t), setActive(bool), destroy()}`. `el` is a `.row` (absolute, top-left origin): the parent positions it with
  `translateY`; `height` is its layout height (title 64 + tiles + caption + 24). Stationary ring at left (visible only when active),
  track slides, pooled tiles. `onNeedMore` fires when focus is within 6 of the end. Pure helpers exported for tests:
  `poolSizeFor, poolWindow, slotOf, trackX, rowHeight`.
- `ui/backdrop.js`: `useAmbience(initial) -> {set(colors), restore()}` (one shared 2x2 WebGL/2D ambience behind all screens;
  call `restore()` in `onShow`), `new HeroArt(parent, 'hero-art home-art', onColors)` with `.set(url)` (cross-fade after decode,
  token guarded, samples colors with `crossOrigin='anonymous'`, falls back to a plain load + warm palette when CORS fails),
  `sampleColors(img)`, `FALLBACK`. Colors are `{tl,tr,bl,br}` of `[r,g,b]`.
- `ui/toast.js`: `toast(text[, ms])`.
- `ui/confirm.js`: `createConfirm()` -> `{el, open({title, sub, confirm, cancel, onConfirm, onCancel}), close(), isOpen(), onKey(action)}`.
  Append `el` to the screen; while open the screen forwards every key to `onKey`. Focus starts on Cancel unless `open({defaultConfirm: true})` (the browse dismiss dialog: Remove is focused, Left/Right switch, Back cancels; the keyup that ends the long press is swallowed, so only a separate OK confirms).
- `ui/row.js` also has `removeWhere(fn) -> n` (focus stays on the nearest survivor) and the helper `indexAfterRemove`.
- Dismiss: long-press OK on a tile of the `resume` / `nextup` rows (`screens/hub.js`) asks "Remove ...?" (Remove focused by default), then calls
  `clearResume` / `dropSeries`, removes the tile in place, calls `hubs.invalidate(id)` and toasts. Detail
  (`DetailScreen({item, from})`, `nav.go('openItem', item, {from:'nextup'})`) shows "Remove from Continue watching" when the
  target has progress and "Remove from Next up" only when opened from the Next up row. `hubs.invalidate(key)` /
  `hubs.invalidatedAt(key)`: browse pages reload a row on show when it was invalidated after they loaded it.
- `ui/grid.js` / `ui/chips.js` / `ui/topbar.js`: see the notes added when they land (below).
- Browse items are Jellyfin DTOs; items restored from the first-paint cache are **slim** (see `hubs.slim`), so a detail
  screen must re-fetch `jellyfin.item(id)` for full data. Items listed from a classified view carry `_kind` ('movie'|'series'|'anime').
- Browse zones (`screens/hub.js`): `nav` -> `hero` -> `rows`. `hero` exists while the spotlight has items and is the startup zone
  (until the first key). In `hero`: OK/long OK opens the shown slide, play/playpause plays it, left/right change slide (wrap), up/back go
  to `nav`, down to `rows`. Rotation (`SPOT_MS` per-slide timeout, count "i / n" and a `scaleX` progress bar) runs in `hero`/`nav` and
  before any move, and is paused in `rows`. Pure helpers: `ui/spotlight.js` (`wrapIndex`, `nextZone`).
- `api/hubs.js`: `kindOf(item)`, `classify(views)`, `viewsFor(kind)`, `recipesFor(kind)`, `homeRecipes()`, `loadViews()`.
- Tabs: `nav.go('openHub', kind)` with `kind` = `'home'|'movies'|'series'|'anime'` switches tab (replaces the tab screen when a
  tab screen is on top, otherwise pushes). Tab screens set `screen.tab = true`.

## Forms phase (agent C): connect, search, settings

- `ui/keyboard.js`: `createField({placeholder,value,type,label,onInput,onDone,onCancel})` ->
  `{el, input, value(), setValue(v), isEditing(), setFocused(bool), focused(), begin(), commit(), cancel(), handleKey(action)->bool}`.
  Visual focus (`setFocused`) shows "Press OK to type"; OK (`enter`) starts editing (real `<input>` gets DOM focus, IME up);
  Done (`imedone`) or Enter commits (`onDone`), Back or `imecancel` reverts (`onCancel`). While editing, `input.js` only
  forwards back/up/down/enter/imedone/imecancel; up/down commit and fall through to the screen. Screens call
  `field.handleKey(action)` first.
- `screens/connect.js`: exports `parseServerInput`, `webAddress(base)`, `hostOf(base)`, `validateServer(base, fetch?, timeoutMs?)`
  (GET `{base}/System/Info/Public`, 6 s), `drawQr(canvas, text, size)`. On Quick Connect success it calls
  `session.signIn` then `router.reset(HomeScreen({}))`. The QR encodes only the server's web origin; the secret never leaves the closure.
- `screens/search.js`: exports `groupResults(items, isAnimeFn?)`, `looksLikeAnime`, `addRecent`, `errorCopy(e)`. Typing never
  searches; one `/Items` request runs when the field is committed (OK/Done) or a recent chip is picked (no `/Search/Hints`). Uses `ui/row.js` `createRow`
  and `hubs.kindOf(item)` (namespace imports, so a missing export degrades instead of breaking boot).
- `screens/settings.js`: store keys written: `hubOverrides` ({[viewId]:{kind?,hidden?}}, kind movie|series|anime),
  `pref4k` (bool, default false), `autoplayNext` (bool, default true), `subLang` ('off' or ISO 639-2: eng nor swe dan ger fre spa jpn,
  default 'off'), `hud` (bool). Calls `hubs.clearBrowseCache()` after a hub override change when it exists.
  `recentSearches` (max 8 strings) is written by Search.
- `ui/hud.js`: `setHud(bool)`, `hudEnabled()`, `initHud()` (called once from `app.js` start). fps over 500 ms + worst frame.
- Dev mock: added `GET /mock/jellyfin/System/Info/Public`.
- CSS: `css/forms.css` (fields, `.conn-*`, `.search-*`, `.set-*`, `.hud`).

## Phase 2, agent B: detail, sources, player

- `screens/detail.js` `DetailScreen({item})`: `item` may be a stub (`{Id, Type, Name}`); the full item
  (with People/Taglines/MediaStreams) is fetched on show and again after returning from the player.
  `Season` items open their series on that season; `Episode` items show episode details + "Go to series".
  Zones: `buttons | seasons | episodes | similar`. The body slides up so the active section's top lands at y=380.
  Play acts on the item, or for a series on NextUp (else the first episode). It calls
  `nav.go('playItem', item, {startMs})`.
- `screens/sources.js`: `createSourcesPanel({onPlay(item, source, info, startMs), onClose()})` ->
  `{el, open(item), close(), isOpen(), onKey(action), destroy()}` (detail embeds it); `SourcesScreen({item})`
  is the nav `openSources` wrapper. The chosen source id is remembered under store key `src.<itemId>`
  (`lastSourceKey(itemId)` is exported from `screens/player.js`). Red searches again (`Refresh`).
- `screens/player.js` `PlayerScreen({item, opts})`; opts: `startMs` (else UserData position), `sourceId`
  (preferred MediaSource Id), `info` (a PlaybackInfo response to reuse; else `playbackInfo(id, {kept:true})`).
  With no `sourceId` the remembered source is used only when resuming (startMs > 0), else `pickSource`.
  Reports `/Sessions/Playing` (+ `/Progress` every 10 s and on pause/unpause/seek, `/Stopped` once on exit/end).
  Errors fall back once to the next playable source (toast), then show a retry box.
  Episodes resolve the next episode through `jellyfin.episodes(seriesId)`; at the end a 10 s up-next card
  (OK plays now via `router.replace`, Back exits). Store keys `player.audioLang`, `player.subLang`, `player.subSize` (32/38/46/56/68 px, default 46).
  The top-right Next episode button appears when a successor exists: Up with the OSD visible focuses it,
  OK plays it; Down/Back/Left/Right return focus to transport. The tracks panel has audio, subtitles and font-size columns.
  Font size is also configurable in Settings and persists across episodes. Embedded and external text share `stripTags`.
- `player/pick.js`: `rankSources(sources) -> [{source, playable, warn, reasons[]}]` (clean playable in server order,
  then playable-with-warning such as Dolby Vision without an HDR fallback, then rejected), `pickSource`, `nextSource`,
  `judge`, `describeSource`, `isUhd`, `nameLines`. DTS-only or TrueHD-only audio is rejected; sources without
  MediaStreams are judged from `aiostreams` tags and the name text; unknown facts never reject.
- `player/subtitles.js`: `parseCues(text) -> [{start,end,text}]` (SRT/VTT, ms), `stripTags`, `CueTrack.textAt(ms)`
  (`at` is an alias; the Chrome 76 lint flags `.at(` calls, so the app uses `textAt`).
- `player/seek.js`: `stepFor(n)`, `Seeker` (commit 900 ms after the last press, streak gap 700 ms).
- `player/osd.js`, `player/tracks.js`: DOM builders used by the player screen; `tracks.js` also has
  `chooseAudio` (DTS avoidance), language helpers.
- `platform/player.js`: `createPlayer(container, listener) -> backend` (AVPlay on Tizen, `<video>` elsewhere);
  interface is documented at the top of the file.
- Mock server additions (`tools/devserver.mjs`): PlaybackInfo sources use a non-http `Path` so the stream route is
  used; the stream route serves `tests/fixtures/mock-video.webm` (12 s, VP8, Range support); subtitle route
  `/Videos/:id/:msid/Subtitles/:i/Stream.<fmt>`; `createServer().playLog` records `/Sessions/Playing*` calls.
- CSS: `css/detail.css` holds the detail, sources and player styles.


## Playback history and episode navigation

- Series detail season counts come from the fetched season list, excluding Specials. Server
  `ChildCount` is an episode total and must not be labeled as a season count there.

- In series episode rows, short OK plays; holding OK opens that episode detail page for Sources and
  Mark watched. Back returns to the series with its episode focus preserved.
- Holding OK on a season offers confirmation to mark that season watched through its season ID.
  Cancel/Back leaves watched state unchanged; successful marking refreshes the episode badges.

- Continue watching uses `player/progress.js` `latestResume`: latest `UserData.LastPlayedDate` per `SeriesId`,
  with server order preserved for equal/missing dates. Movies and episodes without a series ID remain distinct.
- `hubs.rememberPlayback` keeps the last 100 locally played series per server/user so completing the newest episode
  does not reveal an older unfinished one. Newer server playback timestamps supersede this local hint.
- Stop reports wait for earlier progress writes; watched marking follows stop. `hubs.afterPlayback` invalidates
  resume/nextup and the browse cache; `playbackSaved` lets detail/history loads wait for these writes.
- `player.creditMinutes`: 0 (off), 1, 2, 3 (default), 5, 10. Stopping within this many minutes of the end marks
  watched; at least half the runtime must have elapsed. Unknown runtimes and failed playback do not qualify.
- Episode details have a second action row (`series` focus zone) for Go to series. It opens `DetailScreen`
  with `focusEpisode`, selects the latest played episode from series history (falling back to that episode),
  and focuses its season and episode row. Up returns to the primary action row.

## Skip intro

- After preparing each episode source, the player requests `/MediaSegments/:itemId?includeSegmentTypes=Intro`.
  `player/segments.js` validates finite start/end ticks against the actual source duration. Missing/invalid markers
  produce no prompt; failed lookups never block playback. Responses from old sources/screens are ignored.
- During an intro, Up reveals and selects Skip intro, including when the OSD is hidden. OK seeks to its end,
  preserving pause state. Right focuses Next episode; Left from Next episode returns to Skip intro while available.
  Down/Back dismiss the intro selection. It disappears at the end of the intro or when the overlay closes.
  Seeking back into the intro makes it available on Up again. There is no automatic skip.

## Series subtitle preferences

- Subtitle selections are saved per server, user and series in `player.seriesSubs.*`. Off is explicit.
  New anime series default to English; other new series use the existing global subtitle default. Font size remains a saved global preference.
- Each episode/source matches the remembered language (including ISO aliases), preferring the same label and
  embedded/external kind when available. IDs and indexes are not reused across episodes. Unknown languages
  require the same label and kind; unavailable languages stay off without discarding the saved choice.
- Source retries reapply the preference; late addon subtitle discovery can apply a newly available match.

## Norwegian discovery

- `api/norwegian.js`: local `discovery.norwegian.*` preferences: enabled, period,
  category, source, includeNews. Defaults: enabled, year, all, all, false. A previous
  `discovery.country=off` remains Off until explicitly enabled.
- `api/hubs.js` adds `norwegianRecipe()` to Home and Series. Its identity includes
  every option and the current date; the heading identifies the selected filters.
- `screens/hub.js` rebuilds these recipes on return from Settings, drops old regional
  and mismatched Norwegian cache rows, and ignores detached row responses.
- Authenticated `GET /Discover/NorwegianShows` takes Period/Category/Source/IncludeNews
  and returns standard Jellyfin list DTOs. It ranks original-language no/nb/nn shows
  by current popularity, filtering episode dates and original network metadata.
- Legacy `/Discover/RegionalShows` remains available to old clients during rollout.

## Track picker

- Audio labels retain AVPlay titles and channels and normalize MIME codecs; unknown languages use numbered tracks.
- Subtitle dialogue previews are disabled: focusing rows never downloads subtitles or requests server media scans. Numbered labels preserve complete supplied track/release titles. Descriptions identify in-video versus downloaded tracks, and forced/signs, SDH and default flags when supplied; missing flags do not imply full dialogue. OK selects and returns to playback; Down reopens the picker with the active track selected. Per-series subtitle preferences remain unchanged.

- Discover and select AVPlay tracks only after `play()` enters PLAYING; asynchronous prepare leaves READY, where normal file track selection is unsupported. Failed selections retain the active subtitle state and are not saved.
