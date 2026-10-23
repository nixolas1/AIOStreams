// Catalog -> Movies / Series / Anime hub classification and row recipes.
//
// The server exposes every catalog as a view with CollectionType only
// movies | tvshows | boxsets (or none) and Path /aiostreams/<type>/<catalogId>.
// Anime is recognised by the catalog type or name; debrid libraries (type
// "library") form the Library tab. The role of a catalog (trending, new, top,
// a streaming service, ...) comes from its name, then its catalog id.
// A "recipe" describes one row: {id, title, tile:'wide'|'poster', badge, paged,
// spotlight, fetch({start, limit}) -> Promise<{items, total, title?}>}.
import * as jf from './jellyfin.js';
import * as client from './client.js';
import * as norwegian from './norwegian.js';
import * as store from '../util/store.js';
import * as session from '../session.js';
import { latestResume } from '../player/progress.js';

export const ANIME_RE = /anime|kitsu|anilist|myanimelist|\bmal\b/i;

const SERVICES = [
  ['Netflix', /netflix/i, 'Netflix'],
  ['HBO', /\bhbo\b|\bmax\b/i, 'HBO Max'],
  ['Disney', /disney/i, 'Disney+'],
  ['Prime', /\bprime\b|amazon/i, 'Prime Video'],
  ['Apple', /apple/i, 'Apple TV+'],
  ['Hulu', /hulu/i, 'Hulu'],
  ['Paramount', /paramount/i, 'Paramount+'],
  ['Peacock', /peacock/i, 'Peacock'],
  ['Crunchyroll', /crunchyroll/i, 'Crunchyroll'],
];
const GENRE_RE = /^(action|adventure|animation|comedy|crime|documentary|drama|family|fantasy|history|horror|music|mystery|romance|sci-?fi|science fiction|thriller|war|western)\b/i;

const DAY = 86400000;

export function normKind(kind) {
  if (kind === 'movies' || kind === 'movie') return 'movie';
  if (kind === 'series' || kind === 'tvshows' || kind === 'tv') return 'series';
  if (kind === 'anime') return 'anime';
  if (kind === 'library') return 'library';
  return null;
}

export function kindLabel(kind) {
  return kind === 'movie' ? 'Movies' : kind === 'series' ? 'Series' : kind === 'library' ? 'Library' : 'Anime';
}

/** {type, catalog} from a view's Path (/aiostreams/<type>/<catalogId>), or empty strings. */
export function catalogOf(view) {
  const m = /^\/aiostreams\/([^/]+)\/(.+)$/.exec((view && view.Path) || '');
  return m ? { type: m[1], catalog: m[2] } : { type: '', catalog: '' };
}

const LIST_RE = /watchlist|favou?rites|my list|collection\b|liked/i;

/** Role of a catalog from its name, else from its catalog id. */
export function roleOf(name, catalogId) {
  const r = roleOfName(name);
  if (r !== 'other' || !catalogId) return r;
  // Catalog ids are terse ("tmdb.top" is TMDB's Popular), so "top" is not trusted there.
  const id = String(catalogId).replace(/[._-]+/g, ' ');
  const byId = roleOfName(id);
  return byId === 'top' || byId === 'genre' ? 'other' : byId;
}

function roleOfName(name) {
  name = String(name || '');
  if (LIST_RE.test(name)) return 'list';
  for (let i = 0; i < SERVICES.length; i++) if (SERVICES[i][1].test(name)) return 'service:' + SERVICES[i][0];
  if (/upcoming|coming soon/i.test(name)) return 'upcoming';
  if (/now playing|airing|on the air|latest|\bnew\b|recent|this season|new releases?/i.test(name)) return 'new';
  if (/top rated|top-rated|highest rated|\bbest\b|imdb top|top \d+|\btop\b/i.test(name)) return 'top';
  if (/trending/i.test(name)) return 'trending';
  if (/popular/i.test(name)) return 'popular';
  if (GENRE_RE.test(name)) return 'genre';
  return 'other';
}

export function serviceName(role) {
  const key = String(role).slice(8);
  for (let i = 0; i < SERVICES.length; i++) if (SERVICES[i][0] === key) return SERVICES[i][2];
  return key;
}

export function kindOfView(view) {
  const c = catalogOf(view);
  if (c.type === 'library') return 'library';
  const text = (view.Name || '') + ' ' + (view.Id || '') + ' ' + c.catalog;
  if (c.type === 'anime' || ANIME_RE.test(text) || view.CollectionType === 'anime') return 'anime';
  const t = view.CollectionType;
  if (t === 'movies' || t === 'boxsets') return 'movie';
  if (t === 'tvshows') return 'series';
  return /series|shows|\btv\b|episodes/i.test(view.Name || '') ? 'series' : 'movie';
}

let current = [];

/**
 * Classify views (jellyfin.views().Items). Applies the store's hubOverrides
 * ({[viewId]: {kind?, role?, hidden?}}) and remembers the result for
 * viewsFor/recipesFor. Returns [{id, name, kind, role, hidden, view}].
 */
export function classify(views, overrides) {
  const ov = overrides || store.get('hubOverrides', {}) || {};
  const out = (views || []).map(function (v) {
    const o = ov[v.Id] || {};
    const kind = normKind(o.kind) || kindOfView(v);
    return { id: v.Id, name: v.Name || '', kind: kind, role: o.role || roleOf(v.Name, catalogOf(v).catalog), hidden: !!o.hidden, view: v };
  });
  current = out;
  return out;
}

export function classified() {
  return current;
}

/** Visible classified views of one kind ('movies'|'movie'|'series'|'anime'). */
export function viewsFor(kind) {
  const k = normKind(kind);
  // Watchlist-style catalogs live in the Library tab, not in the kind hubs.
  return current.filter(function (v) { return !v.hidden && v.kind === k && (k === 'library' || v.role !== 'list'); });
}

let viewsPromise = null;

/** Cold start: restore the last view list synchronously (or null). */
export function restoreViews() {
  const slim = store.get('views', null);
  if (!slim || !slim.length) return null;
  return classify(slim);
}

/** Fetch (once per session unless force) and classify the catalog views. */
export function loadViews(force) {
  if (viewsPromise && !force) return viewsPromise;
  viewsPromise = jf.views().then(function (r) {
    const items = (r && r.Items) || [];
    store.set('views', items.map(function (v) { return { Id: v.Id, Name: v.Name, CollectionType: v.CollectionType, Path: v.Path }; }));
    return classify(items);
  }).catch(function (e) {
    viewsPromise = null;
    throw e;
  });
  return viewsPromise;
}

/** The catalog a genre chip opens: the most general view of the kind. */
export function primaryView(kind) {
  const vs = viewsFor(kind);
  const pick = vs.filter(function (v) { return v.role === 'popular'; })[0]
    || vs.filter(function (v) { return v.role === 'trending'; })[0] || vs[0];
  return pick ? pick.view : null;
}

// ---------- item kind learning ----------
// Resume/NextUp/Upcoming carry no hint that a series is anime, so every item
// listed from a classified view teaches us id -> kind (persisted).
let kindMap = null;
let kindDirty = false;
let kindTimer = 0;
const KIND_CODE = { movie: 'm', series: 's', anime: 'a' };
const CODE_KIND = { m: 'movie', s: 'series', a: 'anime' };
const KIND_MAX = 3000;

function map() {
  if (!kindMap) kindMap = store.get('kindMap', {}) || {};
  return kindMap;
}

function persistKinds() {
  kindTimer = 0;
  if (!kindDirty) return;
  kindDirty = false;
  const m = map();
  const keys = Object.keys(m);
  if (keys.length > KIND_MAX) {
    const next = {};
    keys.slice(keys.length - KIND_MAX).forEach(function (k) { next[k] = m[k]; });
    kindMap = next;
  }
  store.set('kindMap', kindMap);
  persistNames();
}

const NAMES_MAX = 3000;
const CJK_RE = /[぀-ヿ一-鿿가-힯]/;
const ANIME_ID_RE = /kitsu|anilist|myanimelist|mal|anidb/i;
let nameMap = null;

function names() {
  if (!nameMap) nameMap = store.get('animeNames', {}) || {};
  return nameMap;
}

function normName(n) {
  const k = String(n || '').toLowerCase().replace(/[\s!-\/:-@\[-`{-~]+/g, '');
  return k.length >= 3 ? k : '';
}

function seriesKey(it) {
  return it.Type === 'Episode' || it.Type === 'Season' ? it.SeriesId : it.Id;
}

function titlesOf(it) {
  const own = it.Type === 'Episode' || it.Type === 'Season' ? it.SeriesName : it.Name;
  return [own, it.OriginalTitle];
}

function learnAnimeName(it) {
  const t = titlesOf(it);
  const m = names();
  for (let i = 0; i < t.length; i++) {
    const k = normName(t[i]);
    if (k && !m[k]) { m[k] = 1; kindDirty = true; }
  }
}

function persistNames() {
  const m = names();
  const keys = Object.keys(m);
  if (keys.length > NAMES_MAX) {
    const next = {};
    keys.slice(keys.length - NAMES_MAX).forEach(function (k) { next[k] = 1; });
    nameMap = next;
  }
  store.set('animeNames', nameMap);
}

/** Anime by what we learned (id, name) or by TMDB metadata (Animation + Japanese origin). */
export function isAnimeItem(it) {
  if (!it) return false;
  if (map()[seriesKey(it)] === 'a') return true;
  const g = it.Genres || [];
  if (g.indexOf('Anime') >= 0) return true;
  const t = titlesOf(it);
  const m = names();
  for (let i = 0; i < t.length; i++) { const k = normName(t[i]); if (k && m[k]) return true; }
  if (g.indexOf('Animation') < 0) return false;
  if (/\bjapan\b|\bjp\b/i.test((it.ProductionLocations || []).join(' '))) return true;
  if (CJK_RE.test(it.OriginalTitle || '')) return true;
  const ids = Object.keys(it.ProviderIds || {});
  for (let i = 0; i < ids.length; i++) if (ANIME_ID_RE.test(ids[i])) return true;
  return false;
}

/**
 * Mark items as coming from a view of `kind` (movie|series|anime|library) and learn their ids.
 * Anime-looking items in a movie/series view become anime; library views never teach.
 */
export function tagItems(items, kind) {
  const m = map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let k = kind;
    if (kind === 'library') {
      it._kind = isAnimeItem(it) ? 'anime' : it.Type === 'Movie' ? 'movie' : 'series';
      continue;
    }
    if (k !== 'anime' && isAnimeItem(it)) k = 'anime';
    it._kind = k;
    const key = seriesKey(it);
    if (k === 'anime') learnAnimeName(it);
    // A learned anime id is never downgraded.
    if (key && m[key] !== KIND_CODE[k] && m[key] !== 'a') { m[key] = KIND_CODE[k]; kindDirty = true; }
  }
  if (kindDirty && !kindTimer) kindTimer = setTimeout(persistKinds, 800);
  return items;
}

/** movie | series | anime for any item, using what was learned. */
export function kindOf(item) {
  if (!item) return 'movie';
  if (item._kind) return item._kind;
  if (isAnimeItem(item)) return 'anime';
  const learned = CODE_KIND[map()[seriesKey(item)]];
  if (learned) return learned;
  return item.Type === 'Movie' ? 'movie' : 'series';
}

// ---------- fetch helpers ----------

const memos = {};
const stamps = {};
function memo(key, fn) {
  const hit = memos[key];
  if (hit && Date.now() - hit.at < 5000) return hit.p;
  const p = fn();
  memos[key] = { at: Date.now(), p: p };
  p.catch(function () { delete memos[key]; });
  return p;
}

/** Forget a memoized row fetch ('resume' | 'nextup' | ...) after the server changed under it. */
export function invalidate(key) {
  delete memos[key];
  stamps[key] = Date.now();
}

/** When `invalidate(key)` last ran (0 = never); a page compares it with its own load time. */
export function invalidatedAt(key) {
  return stamps[key] || 0;
}

function itemsOf(r) {
  return (r && r.Items) || [];
}

function sinceDays(n) {
  return new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
}

/** Paged catalog fetch for one classified view. */
function catalog(v, o) {
  o = o || {};
  const limit = o.limit || 24;
  return jf.items({
    parentId: v.id, startIndex: o.start || 0, limit: limit,
    sortBy: o.sortBy, sortOrder: o.sortOrder, minPremiereDate: o.minPremiereDate,
  }).then(function (r) {
    const items = tagItems(itemsOf(r), v.kind);
    return { items: items, total: r && r.TotalRecordCount != null ? r.TotalRecordCount : items.length };
  });
}

function dedupe(items) {
  const seen = {};
  return items.filter(function (it) {
    const k = it.Type === 'Episode' ? 'e' + it.SeriesId : it.Id;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function sortNewest(items) {
  return items.slice().sort(function (a, b) {
    return (Date.parse(b.PremiereDate) || 0) - (Date.parse(a.PremiereDate) || 0);
  });
}

function fits(kind) {
  return function (it) { return !kind || kindOf(it) === kind; };
}

let watchUpdate = Promise.resolve();
export function playbackSaved() { return watchUpdate; }
function recentKey() { return 'player.recent.' + session.getBase() + ':' + session.userId(); }
export function rememberPlayback(item, played) {
  if (item.Type !== 'Episode' || !item.SeriesId) return;
  const recent = store.get(recentKey(), {}) || {};
  recent[item.SeriesId] = { id: item.Id, at: Date.now(), played: played };
  const keys = Object.keys(recent).sort(function (a, b) { return recent[b].at - recent[a].at; });
  for (let i = 100; i < keys.length; i++) delete recent[keys[i]];
  store.set(recentKey(), recent);
}
/** Resume/Next up must wait for the final stop and watched writes before fetching. */
export function afterPlayback(promise) {
  watchUpdate = Promise.all([watchUpdate, promise.catch(function () {})]).then(function () {});
  invalidate('resume');
  invalidate('nextup');
  clearBrowseCache();
}
function resumeItems() {
  return memo('resume', function () {
    return watchUpdate.then(function () { return jf.resume({ limit: 100 }); }).then(function (r) {
      return latestResume(itemsOf(r), store.get(recentKey(), {}));
    });
  });
}
function nextUpItems() {
  return memo('nextup', function () { return watchUpdate.then(function () { return jf.nextUp({ limit: 40 }); }).then(itemsOf); });
}
function upcomingItems() {
  return memo('upcoming', function () { return jf.upcoming({ limit: 40 }).then(itemsOf); });
}

function once(items) {
  return { items: items, total: items.length };
}

function notAnime(it) {
  return kindOf(it) !== 'anime';
}

/**
 * Paged catalog without the items `keep` rejects. Keeps its own server cursor
 * (reset at start 0), reads up to a few server pages per call until `limit`
 * items are kept, and reports a total that stays ahead of what was shown
 * until the server is exhausted so the row keeps paging.
 */
function filteredCatalog(v, keep) {
  const SERVER_PAGE = 24;
  const MAX_READS = 3;
  let next = 0;        // next server index to read
  let done = false;    // server has nothing more
  let spare = [];      // kept but not yet returned
  let skip = 0;        // kept items to discard when resuming without a cursor
  let started = false;
  function reset(discard) { next = 0; done = false; spare = []; skip = discard; started = true; }
  return function (p) {
    const start = (p && p.start) || 0;
    const limit = (p && p.limit) || SERVER_PAGE;
    if (start === 0) reset(0);
    else if (!started) reset(start);
    let reads = 0;
    const maxReads = MAX_READS + Math.ceil(skip / SERVER_PAGE);
    function fill() {
      if (done || reads >= maxReads || spare.length >= skip + limit) return Promise.resolve();
      return catalog(v, { start: next, limit: SERVER_PAGE }).then(function (r) {
        reads++;
        next += r.items.length;
        done = r.items.length < SERVER_PAGE || next >= r.total;
        spare = spare.concat(r.items.filter(keep));
        return fill();
      });
    }
    return fill().then(function () {
      const d = Math.min(skip, spare.length);
      spare = spare.slice(d);
      skip -= d;
      const out = spare.slice(0, limit);
      spare = spare.slice(out.length);
      return { items: out, total: start + out.length + spare.length + (done ? 0 : 1) };
    });
  };
}

/** Fetch one kind's catalog page, dropping anime from movie/series catalogs. */
function plainOrFiltered(v) {
  return v.kind === 'movie' || v.kind === 'series' ? filteredCatalog(v, notAnime) : function (p) {
    return catalog(v, { start: p && p.start, limit: (p && p.limit) || 24 });
  };
}

const FRESH_DAYS = 120;
const MIN_FRESH = 8;

/** One kind's recent titles: its role-new catalog, else trending/popular since 90 days ago. */
function newOfKind(kind) {
  const vs = viewsFor(kind);
  function role(r) { return vs.filter(function (v) { return v.role === r; })[0]; }
  const fresh = role('new');
  const src = fresh || role('trending') || role('popular');
  if (!src) return Promise.resolve([]);
  const o = fresh ? { limit: 24 } : { limit: 40, minPremiereDate: sinceDays(90), sortBy: 'PremiereDate', sortOrder: 'Descending' };
  return catalog(src, o).then(function (r) {
    const items = kind === 'anime' ? r.items : r.items.filter(notAnime);
    const cut = Date.now() - FRESH_DAYS * DAY;
    const recent = items.filter(function (it) {
      const t = Date.parse(it.PremiereDate);
      return !t || t >= cut;
    });
    return recent.length >= MIN_FRESH ? recent : sortNewest(items);
  });
}

/** New releases across kinds, one source per kind, interleaved round-robin. */
function newReleases(kinds, id, title, tile, badge) {
  return {
    id: id, title: title, tile: tile || 'poster', badge: !!badge,
    fetch: function () {
      return Promise.all(kinds.map(newOfKind)).then(function (lists) {
        const all = [];
        for (let i = 0; all.length < 200; i++) {
          let any = false;
          lists.forEach(function (l) { if (i < l.length) { all.push(l[i]); any = true; } });
          if (!any) break;
        }
        return once(dedupe(all).slice(0, 24));
      });
    },
  };
}

function resumeRecipe(kind, badge) {
  return {
    id: 'resume', title: 'Continue watching', tile: 'wide', badge: !!badge,
    fetch: function () { return resumeItems().then(function (xs) { return once(xs.filter(fits(kind))); }); },
  };
}

function nextUpRecipe(kind, badge) {
  return {
    id: 'nextup', title: 'Next up', tile: 'wide', badge: !!badge,
    fetch: function () { return nextUpItems().then(function (xs) { return once(xs.filter(fits(kind))); }); },
  };
}

function freshRecipe(kind) {
  return {
    id: 'fresh', title: kind === 'anime' ? 'Airing now' : 'Fresh this week', tile: 'wide', badge: false,
    fetch: function () {
      return Promise.all([nextUpItems(), upcomingItems()]).then(function (rs) {
        return once(dedupe(rs[0].concat(rs[1]).filter(fits(kind))).slice(0, 24));
      });
    },
  };
}

function becauseRecipe(kind, badge) {
  return {
    id: 'because', title: 'Because you watched', tile: 'poster', badge: !!badge,
    fetch: function () {
      return resumeItems().then(function (xs) {
        const mine = xs.filter(fits(kind));
        if (mine.length) return mine[0];
        return jf.items({
          filters: 'IsPlayed', sortBy: 'DatePlayed', sortOrder: 'Descending', limit: 30, includeItemTypes: 'Movie,Episode',
        }).then(function (r) { return itemsOf(r).filter(fits(kind))[0] || null; });
      }).then(function (seed) {
        if (!seed) return once([]);
        const id = seed.Type === 'Episode' ? seed.SeriesId : seed.Id;
        const name = seed.Type === 'Episode' ? seed.SeriesName : seed.Name;
        return jf.similar(id, 24).then(function (r) {
          const items = itemsOf(r);
          tagItems(items, kindOf(seed));
          return { items: items, total: items.length, title: name ? 'Because you watched ' + name : 'Because you watched' };
        });
      });
    },
  };
}

function viewRecipe(v, id, title, spotlight) {
  return {
    id: id, title: title, tile: 'poster', badge: false, paged: true, spotlight: spotlight || 0,
    fetch: plainOrFiltered(v),
  };
}

/** Favourites ("My list"), limited to one hub kind when given. */
function favoritesRecipe(kind, badge) {
  return {
    id: 'mylist', title: 'My list', tile: 'poster', badge: !!badge,
    fetch: function () {
      return jf.favorites({ limit: 100 }).then(function (r) { return once(itemsOf(r).filter(fits(kind))); });
    },
  };
}

/** A debrid-library (or watchlist) catalog as a paged row, never anime-filtered. */
function libraryViewRecipe(v, badge) {
  return {
    id: 'lib-' + v.id, title: /library/i.test(v.name) ? v.name : 'Your ' + v.name + ' library', tile: 'poster', badge: !!badge,
    paged: true, spotlight: 0,
    fetch: function (p) { return catalog(v, { start: p && p.start, limit: (p && p.limit) || 24 }); },
  };
}

/** Titles played before, most recent first. */
function watchedRecipe() {
  return {
    id: 'watched', title: 'Watched', tile: 'poster', badge: true,
    fetch: function () {
      return jf.items({
        filters: 'IsPlayed', sortBy: 'DatePlayed', sortOrder: 'Descending', includeItemTypes: 'Movie,Series', recursive: true, limit: 40,
      }).then(function (r) { return once(itemsOf(r)); });
    },
  };
}

function libraryRecipes() {
  const rows = [resumeRecipe(null, true), favoritesRecipe(null, true)];
  viewsFor('library').forEach(function (v) { rows.push(libraryViewRecipe(v, true)); });
  current.forEach(function (v) {
    if (!v.hidden && v.role === 'list' && v.kind !== 'library') rows.push(libraryViewRecipe(v, true));
  });
  rows.push(watchedRecipe());
  const lead = rows.filter(function (r) { return r.paged; })[0] || rows[1];
  lead.spotlight = 5;
  return rows;
}

export function norwegianRecipe() {
  if (!norwegian.enabled()) return null;
  const o = norwegian.options();
  return { id: norwegian.rowId(), title: norwegian.title(), tile: 'poster', paged: false,
    fetch: async function () {
      const result = await client.get('/Discover/NorwegianShows', {
        Period: o.period, Category: o.category, Source: o.source, IncludeNews: String(o.includeNews),
      });
      return { items: tagItems(result.Items || [], 'series'), total: result.TotalRecordCount || 0 };
    },
  };
}

/** Ordered row recipes for a hub ('movies'|'series'|'anime'). */
export function recipesFor(kindIn) {
  const kind = normKind(kindIn);
  if (kind === 'library') return libraryRecipes();
  const vs = viewsFor(kind);
  const used = {};
  const rows = [];
  function first(role) {
    for (let i = 0; i < vs.length; i++) if (vs[i].role === role && !used[vs[i].id]) return vs[i];
    return null;
  }
  function use(v) { if (v) used[v.id] = true; return v; }

  rows.push(resumeRecipe(kind, false));
  rows.push(favoritesRecipe(kind, false));

  const norwegianRow = kind === 'series' ? norwegianRecipe() : null;
  if (norwegianRow) rows.push(norwegianRow);

  const trending = use(first('trending') || first('popular'));
  if (trending) rows.push(viewRecipe(trending, 'trending', 'Trending now', 5));

  const newV = first('new');
  if (newV) use(newV);
  rows.push(newV ? viewRecipe(newV, 'new', kind === 'anime' ? 'New this season' : 'New releases', trending ? 0 : 5)
    : newReleases([kind], 'new', 'New releases'));

  if (kind !== 'movie') rows.push(freshRecipe(kind));

  const up = use(first('upcoming'));
  if (up) rows.push(viewRecipe(up, 'upcoming', 'Coming soon'));

  vs.forEach(function (v) {
    if (v.role.indexOf('service:') === 0 && !used[v.id]) {
      use(v);
      rows.push(viewRecipe(v, 'svc-' + v.id, 'Top on ' + serviceName(v.role)));
    }
  });

  rows.push(becauseRecipe(kind, false));

  const top = use(first('top'));
  if (top) rows.push(viewRecipe(top, 'top', 'Top rated'));

  vs.forEach(function (v) {
    if (!used[v.id]) {
      use(v);
      rows.push(viewRecipe(v, 'v-' + v.id, v.name));
    }
  });

  // First catalog doubles as the spotlight when nothing else claimed it.
  if (!rows.some(function (r) { return r.spotlight; })) {
    for (let i = 0; i < rows.length; i++) if (rows[i].paged) { rows[i].spotlight = 5; break; }
  }

  rows.push({ id: 'genres', title: 'Browse by genre', chips: true, kind: kind });
  return rows;
}

/** Home page recipes (mixed kinds, kind badges on the mixed rows). */
export function homeRecipes() {
  const rows = [];
  function bestOf(kind, roles) {
    const vs = viewsFor(kind);
    for (let r = 0; r < roles.length; r++) {
      for (let i = 0; i < vs.length; i++) if (vs[i].role === roles[r]) return vs[i];
    }
    return null;
  }
  rows.push(resumeRecipe(null, true));
  rows.push(nextUpRecipe(null, true));
  const norwegianRow = norwegianRecipe();
  if (norwegianRow) rows.push(norwegianRow);
  rows.push(favoritesRecipe(null, true));
  viewsFor('library').slice(0, 2).forEach(function (v) { rows.push(libraryViewRecipe(v, true)); });
  rows.push(newReleases(['movie', 'series', 'anime'], 'new-week', 'New releases', 'poster', true));
  const tm = bestOf('movie', ['trending', 'popular']);
  if (tm) { const r = viewRecipe(tm, 'trending-movies', 'Trending movies', 3); rows.push(r); }
  const ts = bestOf('series', ['trending', 'popular']);
  if (ts) { const r = viewRecipe(ts, 'trending-series', 'Trending series', 2); rows.push(r); }
  const an = bestOf('anime', ['new', 'trending', 'popular']);
  if (an) rows.push(viewRecipe(an, 'airing-anime', 'Airing anime'));
  rows.push(becauseRecipe(null, true));
  if (!rows.some(function (r) { return r.spotlight; })) {
    for (let i = 0; i < rows.length; i++) if (rows[i].paged) { rows[i].spotlight = 5; break; }
  }
  return rows;
}

// ---------- slim cache ----------

/** Keep only fields the browse screens render (localStorage first paint). */
export function slim(it) {
  const o = {
    Id: it.Id, Name: it.Name, Type: it.Type, _kind: it._kind,
    ProductionYear: it.ProductionYear, OfficialRating: it.OfficialRating, CommunityRating: it.CommunityRating,
    RunTimeTicks: it.RunTimeTicks, ChildCount: it.ChildCount, PremiereDate: it.PremiereDate,
    SeriesId: it.SeriesId, SeriesName: it.SeriesName, SeriesPrimaryImageTag: it.SeriesPrimaryImageTag,
    ParentIndexNumber: it.ParentIndexNumber, IndexNumber: it.IndexNumber,
    ParentBackdropItemId: it.ParentBackdropItemId, ParentBackdropImageTags: it.ParentBackdropImageTags,
    ParentLogoItemId: it.ParentLogoItemId, ParentLogoImageTag: it.ParentLogoImageTag,
    BackdropImageTags: it.BackdropImageTags && it.BackdropImageTags.slice(0, 1),
  };
  if (it.Overview) o.Overview = it.Overview.length > 320 ? it.Overview.slice(0, 320) : it.Overview;
  if (it.Genres) o.Genres = it.Genres.slice(0, 3);
  if (it.ImageTags) {
    o.ImageTags = {};
    ['Primary', 'Thumb', 'Logo'].forEach(function (k) { if (it.ImageTags[k]) o.ImageTags[k] = it.ImageTags[k]; });
  }
  if (it.UserData) {
    const u = it.UserData;
    o.UserData = { PlayedPercentage: u.PlayedPercentage, Played: u.Played, UnplayedItemCount: u.UnplayedItemCount, PlaybackPositionTicks: u.PlaybackPositionTicks };
  }
  return o;
}

/** Drop the first-paint caches and the classification (call after changing hubOverrides). */
export function clearBrowseCache() {
  ['page.home', 'page.movies', 'page.series', 'page.anime', 'page.library', 'views'].forEach(function (k) { store.remove(k); });
  current = [];
  viewsPromise = null;
}
