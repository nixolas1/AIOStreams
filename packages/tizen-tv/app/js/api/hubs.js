// Catalog -> Movies / Series / Anime hub classification and row recipes.
//
// The server exposes every catalog as a view with CollectionType only
// movies | tvshows | boxsets (or none). Anime is recognised by name, the role
// of a catalog (trending, new, top, a streaming service, ...) too.
// A "recipe" describes one row: {id, title, tile:'wide'|'poster', badge, paged,
// spotlight, fetch({start, limit}) -> Promise<{items, total, title?}>}.
import * as jf from './jellyfin.js';
import * as store from '../util/store.js';

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
  return null;
}

export function kindLabel(kind) {
  return kind === 'movie' ? 'Movies' : kind === 'series' ? 'Series' : 'Anime';
}

/** Role of a catalog from its name. */
export function roleOf(name) {
  name = String(name || '');
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
  const text = (view.Name || '') + ' ' + (view.Id || '');
  if (ANIME_RE.test(text) || view.CollectionType === 'anime') return 'anime';
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
    return { id: v.Id, name: v.Name || '', kind: kind, role: o.role || roleOf(v.Name), hidden: !!o.hidden, view: v };
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
  return current.filter(function (v) { return !v.hidden && v.kind === k; });
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
    store.set('views', items.map(function (v) { return { Id: v.Id, Name: v.Name, CollectionType: v.CollectionType }; }));
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
}

/** Mark items as coming from a view of `kind` (movie|series|anime) and learn their ids. */
export function tagItems(items, kind) {
  const m = map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    it._kind = kind;
    const code = KIND_CODE[kind];
    const key = it.Type === 'Episode' || it.Type === 'Season' ? it.SeriesId : it.Id;
    if (key && m[key] !== code) { m[key] = code; kindDirty = true; }
  }
  if (kindDirty && !kindTimer) kindTimer = setTimeout(persistKinds, 800);
  return items;
}

/** movie | series | anime for any item, using what was learned. */
export function kindOf(item) {
  if (!item) return 'movie';
  if (item._kind) return item._kind;
  const m = map();
  const key = item.Type === 'Episode' || item.Type === 'Season' ? item.SeriesId : item.Id;
  const learned = CODE_KIND[m[key]];
  if (learned) return learned;
  return item.Type === 'Movie' ? 'movie' : 'series';
}

// ---------- fetch helpers ----------

const memos = {};
function memo(key, fn) {
  const hit = memos[key];
  if (hit && Date.now() - hit.at < 5000) return hit.p;
  const p = fn();
  memos[key] = { at: Date.now(), p: p };
  p.catch(function () { delete memos[key]; });
  return p;
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

function resumeItems() {
  return memo('resume', function () { return jf.resume({ limit: 50 }).then(itemsOf); });
}
function nextUpItems() {
  return memo('nextup', function () { return jf.nextUp({ limit: 40 }).then(itemsOf); });
}
function upcomingItems() {
  return memo('upcoming', function () { return jf.upcoming({ limit: 40 }).then(itemsOf); });
}

function once(items) {
  return { items: items, total: items.length };
}

/** New releases for kinds: a role-new catalog, else recent popular titles. */
function newReleases(kinds, id, title, tile, badge) {
  return {
    id: id, title: title, tile: tile || 'poster', badge: !!badge,
    fetch: function () {
      const vs = [];
      kinds.forEach(function (k) { vs.push.apply(vs, viewsFor(k)); });
      const fresh = vs.filter(function (v) { return v.role === 'new'; });
      if (fresh.length && !badge) return catalog(fresh[0], { limit: 24 });
      const src = (fresh.length ? fresh : vs.filter(function (v) { return v.role === 'trending' || v.role === 'popular'; })).slice(0, 4);
      return Promise.all(src.map(function (v) {
        return catalog(v, fresh.length ? { limit: 12 } : { limit: 40, minPremiereDate: sinceDays(90), sortBy: 'PremiereDate', sortOrder: 'Descending' });
      })).then(function (rs) {
        let all = [];
        rs.forEach(function (r) { all = all.concat(r.items); });
        all = sortNewest(dedupe(all)).slice(0, 24);
        return once(all);
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
    fetch: function (p) { return catalog(v, { start: p && p.start, limit: (p && p.limit) || 24 }); },
  };
}

/** Ordered row recipes for a hub ('movies'|'series'|'anime'). */
export function recipesFor(kindIn) {
  const kind = normKind(kindIn);
  const vs = viewsFor(kind);
  const used = {};
  const rows = [];
  function first(role) {
    for (let i = 0; i < vs.length; i++) if (vs[i].role === role && !used[vs[i].id]) return vs[i];
    return null;
  }
  function use(v) { if (v) used[v.id] = true; return v; }

  rows.push(resumeRecipe(kind, false));

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
  rows.push(newReleases(['movie', 'series', 'anime'], 'new-week', 'New this week', 'poster', true));
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
  ['page.home', 'page.movies', 'page.series', 'page.anime', 'views'].forEach(function (k) { store.remove(k); });
  current = [];
  viewsPromise = null;
}
