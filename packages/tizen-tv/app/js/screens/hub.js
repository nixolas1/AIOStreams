// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0 (home layout, hero/row focus handling)
// The browse page shared by Home and the Movies / Series / Anime hubs:
// top bar, hero (spotlight or focused item), and lazily loaded rows built from
// api/hubs.js recipes. The last payload per page is cached for a fast cold start.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { createRow } from '../ui/row.js';
import { createChips } from '../ui/chips.js';
import { createTopbar } from '../ui/topbar.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { imageFor } from '../ui/tile.js';
import { prefetch } from '../ui/images.js';
import { toast } from '../ui/toast.js';
import { isFast } from '../input.js';
import * as nav from '../nav.js';
import * as store from '../util/store.js';
import * as jf from '../api/jellyfin.js';
import * as hubs from '../api/hubs.js';
import { metaLine } from '../util/format.js';

const ROWS_TOP = 600;
const PAGE = 24;
const AHEAD = 4;            // rows loaded beyond the focused one
const SPOT_MS = 9000;
const STALE_MS = 30000;
const CACHE_ROWS = 12;      // items per row kept in the first-paint cache
const CACHE_VERSION = 2;

function add(parent, tag, cls) {
  const e = h(tag, cls);
  parent.appendChild(e);
  return e;
}

/**
 * opts: {tab: 'home'|'movies'|'series'|'anime', name, kind (hub kind for genre chips; home: null),
 *        build() -> recipes}
 */
export function createBrowsePage(opts) {
  const tab = opts.tab;
  const cacheKey = 'page.' + tab;
  const el = h('div', 'screen browse browse-' + tab);
  el.dataset.screen = opts.name;
  el.dataset.tab = tab;
  const ambience = useAmbience();
  const art = new HeroArt(el, 'hero-art home-art', function (c) { ambience.set(c); });
  const topbar = createTopbar({ current: tab });
  el.appendChild(topbar.el);

  const info = add(el, 'div', 'hero-info');
  const heroHead = add(info, 'div', 'hero-head');
  const heroLogo = add(heroHead, 'img', 'hero-logo');
  heroLogo.alt = '';
  const heroTitle = add(heroHead, 'h1', 'hero-title');
  const heroMeta = add(info, 'div', 'hero-meta');
  const heroSummary = add(info, 'p', 'hero-summary');
  const heroChips = add(info, 'div', 'hero-chips');

  const clip = add(el, 'div', 'browse-rows');
  clip.style.top = ROWS_TOP + 'px';
  const track = add(clip, 'div', 'rows-track');
  const empty = add(el, 'div', 'browse-empty');

  let slots = [];          // {id, recipe, ui, state, count}
  let zone = 'rows';
  let rowIndex = 0;
  let focusSlot = null;
  let moved = false;       // any focus move since the page opened
  let spot = [];
  let spotIndex = 0;
  let spotTimer = 0;
  let heroItem = null;
  let heroTimer = 0;
  let logoToken = 0;
  let chipsKey = '';
  let shown = false;
  let loadedAt = 0;
  let saveTimer = 0;
  let toasted = false;
  let alive = true;
  let viewsFailed = false;

  // ---------- hero ----------

  function showHero(item) {
    if (!item || item === heroItem) return;
    heroItem = item;
    const episode = item.Type === 'Episode';
    setText(heroTitle, episode ? (item.SeriesName || item.Name) : item.Name);
    setText(heroMeta, (episode && item.Name ? item.Name + '  ·  ' : '') + metaLine(item));
    setText(heroSummary, item.Overview || '');
    const genres = (item.Genres || []).slice(0, 3);
    const gk = genres.join('|');
    if (gk !== chipsKey) {
      chipsKey = gk;
      heroChips.textContent = '';
      genres.forEach(function (g) { add(heroChips, 'span', 'chip').textContent = g; });
    }
    // Logo art when the item has some (decide before showing anything: no flash of the title).
    const token = ++logoToken;
    const logo = imageFor(item, 'Logo', 640);
    if (!logo) {
      info.className = 'hero-info no-logo';
    } else {
      info.className = 'hero-info wait';
      const im = new Image();
      im.src = logo;
      const ok = function () {
        if (token !== logoToken) return;
        heroLogo.src = logo;
        info.className = 'hero-info has-logo';
      };
      const fail = function () {
        if (token !== logoToken) return;
        info.className = 'hero-info no-logo';
      };
      if (im.decode) im.decode().then(ok, fail);
      else { im.onload = ok; im.onerror = fail; }
    }
    art.set(imageFor(item, 'Backdrop', 1344) || imageFor(item, 'Primary', 1344) || imageFor(item, 'Thumb', 1344));
  }

  function onFocusItem(item) {
    moved = true;
    clearTimeout(heroTimer);
    if (isFast()) heroTimer = setTimeout(function () { showHero(item); }, 160);
    else showHero(item);
  }

  function rebuildSpot() {
    const next = [];
    const seen = {};
    slots.forEach(function (s) {
      const n = s.recipe && s.recipe.spotlight;
      if (!n || !s.ui || !s.ui.count()) return;
      const its = s.ui.items();
      for (let i = 0; i < its.length && i < n; i++) {
        if (seen[its[i].Id] || !imageFor(its[i], 'Backdrop', 1344)) continue;
        seen[its[i].Id] = true;
        next.push(its[i]);
      }
    });
    spot = next.slice(0, 5);
    if (spotIndex >= spot.length) spotIndex = 0;
    if (spot.length && (!moved || zone === 'nav')) showHero(spot[spotIndex]);
    else if (!heroItem && slots.length) {
      // No spotlight art at all: show the first item of the first row.
      const vis = visible();
      if (vis.length && vis[0].ui.item && vis[0].ui.item() && !vis[0].recipe.chips) showHero(vis[0].ui.item());
    }
  }

  function spinSpot() {
    if (!shown || document.hidden || spot.length < 2) return;
    if (moved && zone !== 'nav') return;
    spotIndex = (spotIndex + 1) % spot.length;
    showHero(spot[spotIndex]);
    prefetch(imageFor(spot[(spotIndex + 1) % spot.length], 'Backdrop', 1344));
  }

  // ---------- rows ----------

  function visible() {
    return slots.filter(function (s) { return s.ui && s.ui.count() > 0; });
  }

  function layout() {
    const vis = visible();
    let y = 0;
    slots.forEach(function (s) {
      if (!s.ui) return;
      if (vis.indexOf(s) < 0) {
        if (s.ui.el.parentNode) s.ui.el.parentNode.removeChild(s.ui.el);
        return;
      }
      if (s.ui.el.parentNode !== track) track.appendChild(s.ui.el);
      setTransform(s.ui.el, 'translateY(' + y + 'px)');
      s.y = y;
      y += s.ui.height;
    });
    const at = focusSlot ? vis.indexOf(focusSlot) : -1;
    rowIndex = at >= 0 ? at : Math.min(rowIndex, Math.max(0, vis.length - 1));
    focusSlot = vis[rowIndex] || null;
    renderRows();
    setText(empty, vis.length ? '' : emptyText());
  }

  function emptyText() {
    if (viewsFailed) return 'Could not reach the server. Press OK to retry.';
    const pending = slots.some(function (s) { return s.state === 'idle' || s.state === 'loading'; });
    if (pending || !slots.length) return '';
    if (slots.every(function (s) { return s.state === 'error'; })) return 'Could not load these rows. Press OK to retry.';
    return 'Nothing here yet. Add catalogs in the AIOStreams configuration.';
  }

  function renderRows() {
    const vis = visible();
    vis.forEach(function (s, i) {
      s.ui.setActive(zone === 'rows' && i === rowIndex);
      toggleClass(s.ui.el, 'above', i < rowIndex);
    });
    const cur = vis[rowIndex];
    setTransform(track, 'translateY(' + (-(cur ? cur.y : 0)) + 'px)');
  }

  function setZone(z) {
    zone = z;
    topbar.setActive(z === 'nav');
    if (z === 'nav') topbar.home();
    renderRows();
    if (z === 'nav' && spot.length) showHero(spot[spotIndex]);
  }

  function makeUi(s, rec, cached) {
    if (rec.chips) {
      return createChips({
        title: rec.title,
        onSelect: function (genre) {
          const v = hubs.primaryView(opts.kind);
          if (v) nav.go('openLibrary', v, { genre: genre });
        },
      });
    }
    return createRow({
      kind: (cached && cached.tile) || rec.tile || 'poster',
      title: rec.title,
      kindBadge: rec.badge,
      onFocus: onFocusItem,
      onSelect: function (item) { nav.go('openItem', item); },
      onNeedMore: function () { loadMore(s); },
    });
  }

  function failed(s, e) {
    s.state = 'error';
    if (typeof console !== 'undefined' && console.warn) console.warn('browse row failed', s.id, e && e.message);
    if (!toasted) {
      toasted = true;
      toast('Could not load ' + (s.recipe.title || 'a row'));
    }
    if (s.id !== 'views' && !visible().length) setText(empty, emptyText());
  }

  function loadChips(s) {
    const pv = hubs.primaryView(opts.kind);
    if (!pv) { s.state = 'done'; layout(); return; }
    jf.genres(pv.Id).then(function (r) {
      if (!alive) return;
      const names = ((r && r.Items) || []).map(function (g) { return g.Name; }).filter(Boolean).slice(0, 30);
      if (names.length) {
        if (!s.ui) { s.ui = makeUi(s, s.recipe); }
        s.ui.setItems(names.map(function (n) { return { label: n, value: n }; }));
      }
      s.state = 'done';
      layout();
      scheduleSave();
    }, function (e) { if (alive) failed(s, e); });
  }

  function loadSlot(s) {
    if (s.state !== 'idle') return;
    s.state = 'loading';
    if (s.recipe.chips) { loadChips(s); return; }
    s.recipe.fetch({ start: 0, limit: PAGE }).then(function (r) {
      if (!alive) return;
      const items = (r && r.items) || [];
      s.total = r && r.total != null ? r.total : items.length;
      s.exhausted = !s.recipe.paged || items.length >= s.total || items.length < PAGE;
      if (items.length) {
        if (!s.ui) s.ui = makeUi(s, s.recipe);
        s.title = r.title || s.recipe.title;
        s.ui.setTitle(s.title);
        s.ui.setItems(items);
      } else if (s.ui) {
        s.ui.setItems([]);
      }
      s.state = 'done';
      loadedAt = Date.now();
      layout();
      if (s.recipe.spotlight) rebuildSpot();
      scheduleSave();
    }, function (e) { if (alive) failed(s, e); });
  }

  function loadMore(s) {
    if (!s.recipe.paged || s.exhausted || s.more || s.state !== 'done' || !s.ui) return;
    s.more = true;
    s.recipe.fetch({ start: s.ui.count(), limit: PAGE }).then(function (r) {
      s.more = false;
      if (!alive) return;
      const items = (r && r.items) || [];
      if (!items.length) { s.exhausted = true; return; }
      s.ui.appendItems(items);
      if (s.ui.count() >= (r.total != null ? r.total : Infinity)) s.exhausted = true;
    }, function () { s.more = false; });
  }

  function ensureLoaded() {
    const pos = focusSlot ? slots.indexOf(focusSlot) : 0;
    const upTo = Math.min(slots.length, Math.max(3, pos + AHEAD));
    for (let i = 0; i < upTo; i++) loadSlot(slots[i]);
  }

  function ensureAll() {
    for (let i = 0; i < slots.length; i++) loadSlot(slots[i]);
  }

  // ---------- cache ----------

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }

  function save() {
    const rows = [];
    slots.forEach(function (s) {
      if (!s.ui || !s.ui.count()) return;
      if (s.recipe.chips) {
        rows.push({ id: s.id, title: s.recipe.title, chips: s.ui.items().map(function (c) { return c.label; }) });
      } else {
        rows.push({
          id: s.id, title: s.title || s.recipe.title, tile: s.recipe.tile, badge: !!s.recipe.badge, spotlight: s.recipe.spotlight || 0,
          items: s.ui.items().slice(0, CACHE_ROWS).map(hubs.slim),
        });
      }
    });
    if (rows.length) store.set(cacheKey, { v: CACHE_VERSION, rows: rows });
  }

  function restoreCache() {
    const c = store.get(cacheKey, null);
    if (!c || c.v !== CACHE_VERSION || !c.rows) return false;
    c.rows.forEach(function (r) {
      const rec = { id: r.id, title: r.title, tile: r.tile, badge: r.badge, spotlight: r.spotlight, chips: !!r.chips };
      const s = { id: r.id, recipe: rec, ui: null, state: 'cached', total: 0, exhausted: true };
      s.ui = makeUi(s, rec, r);
      if (r.chips) s.ui.setItems(r.chips.map(function (n) { return { label: n, value: n }; }));
      else s.ui.setItems(r.items);
      slots.push(s);
    });
    layout();
    rebuildSpot();
    return slots.length > 0;
  }

  // ---------- recipes ----------

  function applyRecipes(recipes) {
    const old = {};
    slots.forEach(function (s) { old[s.id] = s; });
    const next = recipes.map(function (rec) {
      const s = old[rec.id];
      if (s) {
        delete old[rec.id];
        s.recipe = rec;
        if (s.state === 'cached' || s.state === 'error') s.state = 'idle';
        else if (s.state === 'done' && Date.now() - loadedAt > STALE_MS) s.state = 'idle';
        s.exhausted = false;
        return s;
      }
      return { id: rec.id, recipe: rec, ui: null, state: 'idle', total: 0, exhausted: false };
    });
    Object.keys(old).forEach(function (k) { if (old[k].ui) old[k].ui.destroy(); });
    slots = next;
    layout();
    ensureLoaded();
  }

  function boot() {
    const hadViews = hubs.restoreViews();
    if (hadViews) applyRecipes(opts.build());
    hubs.loadViews().then(function () {
      if (!alive) return;
      viewsFailed = false;
      applyRecipes(opts.build());
    }, function (e) {
      if (!alive) return;
      if (!hadViews) {
        viewsFailed = true;
        setText(empty, emptyText());
      }
      failed({ id: 'views', recipe: { title: 'catalogs' } }, e);
    });
  }

  restoreCache();
  boot();

  // ---------- keys ----------

  function jumpTop() {
    const vis = visible();
    vis.forEach(function (s) { if (s.ui.index() > 0) s.ui.setIndex(0); });
    rowIndex = 0;
    focusSlot = vis[0] || null;
    renderRows();
    const first = vis[0];
    if (first && !first.recipe.chips && first.ui.item()) onFocusItem(first.ui.item());
    ensureLoaded();
  }

  function onKey(action) {
    const vis = visible();
    if (zone === 'nav') {
      switch (action) {
        case 'left': topbar.move(-1); return true;
        case 'right': topbar.move(1); return true;
        case 'down': setZone('rows'); return true;
        case 'enter': topbar.select(); return true;
        case 'back':
          if (tab !== 'home') { nav.go('openHub', 'home'); return true; }
          return false;
        default: return false;
      }
    }
    const s = vis[rowIndex];
    if (!s) {
      if (action === 'up' || action === 'back') { setZone('nav'); return true; }
      if (action === 'enter') {
        viewsFailed = false;
        slots.forEach(function (x) { if (x.state === 'error') x.state = 'idle'; });
        hubs.loadViews(true).then(function () { applyRecipes(opts.build()); }, function () { viewsFailed = true; setText(empty, emptyText()); });
        return true;
      }
      return false;
    }
    switch (action) {
      case 'left': s.ui.move(-1); return true;
      case 'right': s.ui.move(1); return true;
      case 'up':
        if (rowIndex === 0) { setZone('nav'); return true; }
        rowIndex--;
        focusSlot = vis[rowIndex];
        renderRows();
        if (!focusSlot.recipe.chips) onFocusItem(focusSlot.ui.item());
        return true;
      case 'down':
        if (rowIndex < vis.length - 1) {
          rowIndex++;
          focusSlot = vis[rowIndex];
          renderRows();
          if (!focusSlot.recipe.chips) onFocusItem(focusSlot.ui.item());
        }
        ensureLoaded();
        if (rowIndex >= vis.length - 2) ensureAll();
        return true;
      case 'enter': s.ui.select(); return true;
      case 'play': case 'playpause':
        if (!s.recipe.chips && s.ui.item()) nav.go('playItem', s.ui.item());
        return true;
      case 'back':
        if (rowIndex > 0 || s.ui.index() > 0) { jumpTop(); return true; }
        setZone('nav');
        return true;
      default: return false;
    }
  }

  return {
    el: el,
    name: opts.name,
    tab: true,
    onShow: function () {
      shown = true;
      ambience.restore();
      clearInterval(spotTimer);
      spotTimer = setInterval(spinSpot, SPOT_MS);
      // Back from playback or detail: progress and Continue watching may have changed.
      if (loadedAt && Date.now() - loadedAt > STALE_MS) {
        slots.forEach(function (s) { if (s.state === 'done') s.state = 'idle'; });
        loadedAt = Date.now();
        ensureLoaded();
      }
    },
    onHide: function () {
      shown = false;
      clearInterval(spotTimer);
      spotTimer = 0;
    },
    onKey: onKey,
    destroy: function () {
      alive = false;
      clearInterval(spotTimer);
      clearTimeout(heroTimer);
      clearTimeout(saveTimer);
      slots.forEach(function (s) { if (s.ui) s.ui.destroy(); });
      art.set('');
    },
  };
}

export function HubScreen(args) {
  const kind = (args && args.kind) || 'movies';
  return createBrowsePage({
    tab: kind, name: 'hub', kind: kind,
    build: function () { return hubs.recipesFor(kind); },
  });
}
