// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0 (settings list and focus behaviour)
// Settings: one vertical list with cream-invert focus, scrolled by transform.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import * as store from '../util/store.js';
import * as norwegian from '../api/norwegian.js';
import * as session from '../session.js';
import * as jellyfin from '../api/jellyfin.js';
import * as nav from '../nav.js';
import { VERSION } from '../config.js';
import { validateServer, hostOf } from './connect.js';
import { setHud, hudEnabled } from '../ui/hud.js';
import * as hubs from '../api/hubs.js'; // namespace import: classify/clearBrowseCache may not exist yet

import { SUBTITLE_SIZES, SUBTITLE_SIZE_LABELS, subtitleSize } from '../player/subtitles.js';

import { CREDIT_MINUTES, creditMinutes } from '../player/progress.js';

const ROW_H = 84;
const HEAD_H = 76;
const TOP = 210;      // list top (px)
const VIEW_H = 820;   // visible list height
const KINDS = ['movie', 'series', 'anime', 'library'];
const KIND_LABEL = { movie: 'Movies', series: 'Series', anime: 'Anime', library: 'Library' };
// ISO 639-2 codes, as Jellyfin media streams use them.
export const SUB_LANGS = [
  ['off', 'Off'], ['eng', 'English'], ['nor', 'Norwegian'], ['swe', 'Swedish'], ['dan', 'Danish'],
  ['ger', 'German'], ['fre', 'French'], ['spa', 'Spanish'], ['jpn', 'Japanese'],
];

/** Local fallback when api/hubs.js is not available. */
export function guessKind(view) {
  const type = /^\/aiostreams\/([^/]+)\//.exec(view.Path || '');
  if (type && (type[1] === 'library' || type[1] === 'anime')) return type[1];
  if (/anime|kitsu|anilist|mal\b/i.test(view.Name || '') || /anime|kitsu|anilist/i.test(view.Id || '')) return 'anime';
  return view.CollectionType === 'tvshows' ? 'series' : 'movie';
}

function cycle(list, cur, dx) {
  let i = list.indexOf(cur);
  if (i < 0) i = 0;
  return list[(i + dx + list.length) % list.length];
}

// classify() may answer an array (parallel to views) or an object keyed by view id.
function lookup(cls, view, i) {
  if (!cls) return null;
  if (Array.isArray(cls)) {
    const hit = cls[i];
    if (hit && (hit.id == null || hit.id === view.Id)) return hit;
    for (let k = 0; k < cls.length; k++) if (cls[k] && (cls[k].id === view.Id || cls[k].viewId === view.Id)) return cls[k];
    return null;
  }
  return cls[view.Id] || null;
}

export function SettingsScreen() {
  let index = 0;
  let items = [];   // focusable rows only: {el, top, label, value(), left?, right?, run?}
  let views = [];
  let cls = null;
  let alive = true;
  let pending = null;
  let pendingTimer = 0;
  let serverName = '';

  const list = h('div', 'set-list');
  const clip = h('div', 'set-clip', [list]);
  const el = h('div', { class: 'screen screen-settings', dataset: { screen: 'settings' } }, [
    h('div', 'topbar', [h('div', 'brand', [h('div', 'brand-mark'), h('div', 'brand-word', 'AIOStreams')])]),
    h('div', 'set-title', 'Settings'),
    clip,
  ]);

  function overrides() {
    const o = store.get('hubOverrides', {});
    return o && typeof o === 'object' ? o : {};
  }
  function saveOverride(id, patch) {
    const o = overrides();
    const cur = o[id] || {};
    for (const k in patch) cur[k] = patch[k];
    o[id] = cur;
    store.set('hubOverrides', o);
    try { if (typeof hubs.clearBrowseCache === 'function') hubs.clearBrowseCache(); } catch (e) { /* ignore */ }
  }

  function bool(key, dflt) { return store.get(key, dflt) !== false && store.get(key, dflt) !== 0; }

  function clearPending() {
    pending = null;
    clearTimeout(pendingTimer);
  }
  function confirmThen(id, fn) {
    if (pending === id) { clearPending(); fn(); return; }
    pending = id;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { pending = null; refresh(); }, 4000);
  }

  function buildDefs() {
    const defs = [];
    const head = function (t) { defs.push({ head: t }); };
    head('Account');
    defs.push({
      label: 'Server', value: function () { return pending === 'server' ? 'Press OK again to switch server' : (serverName ? serverName + '  ·  ' : '') + hostOf(session.getBase()); },
      run: function () { confirmThen('server', function () { session.signOut(); nav.go('openConnect'); }); },
    });
    defs.push({
      label: 'Signed in as', value: function () { return pending === 'out' ? 'Press OK again to sign out' : (session.userName() || 'Unknown') + '  ·  Sign out'; },
      run: function () { confirmThen('out', function () { session.signOut(); nav.go('openConnect'); }); },
    });
    head('Norwegian shows');
    function saveDiscovery(key, value) { norwegian.set(key, value); hubs.clearBrowseCache(); }
    function discoveryChoice(key, title, choices) {
      const step = function (dx) { saveDiscovery(key, cycle(choices.map(function (entry) { return entry[0]; }), norwegian.options()[key], dx)); };
      defs.push({ label: title, value: function () { return '‹  ' + norwegian.label(choices, norwegian.options()[key]) + '  ›'; },
        left: function () { step(-1); }, right: function () { step(1); }, run: function () { step(1); } });
    }
    defs.push({ label: 'Show Norske serier', value: function () { return norwegian.enabled() ? 'On' : 'Off'; },
      run: function () { saveDiscovery('enabled', !norwegian.enabled()); } });
    discoveryChoice('period', 'Episodes aired', norwegian.PERIODS);
    discoveryChoice('category', 'Category', norwegian.CATEGORIES);
    discoveryChoice('source', 'Broadcaster', norwegian.SOURCES);
    defs.push({ label: 'Include news', value: function () { return norwegian.options().includeNews ? 'On' : 'Off'; },
      run: function () { saveDiscovery('includeNews', !norwegian.options().includeNews); } });
    defs.push({ label: 'Ranking', value: function () { return 'Current TMDB popularity · Norwegian-language originals'; } });
    head('Home rows');
    if (!views.length) {
      defs.push({ label: 'Catalogs', value: function () { return 'Loading...'; } });
    }
    views.forEach(function (v, i) {
      const c = lookup(cls, v, i) || {};
      const detected = c.kind && KINDS.indexOf(c.kind) >= 0 ? c.kind : guessKind(v);
      const role = c.role || 'other';
      const kindOf = function () { const o = overrides()[v.Id] || {}; return o.kind || detected; };
      const step = function (dx) { saveOverride(v.Id, { kind: cycle(KINDS, kindOf(), dx) }); };
      defs.push({
        label: v.Name || v.Id,
        value: function () {
          const o = overrides()[v.Id] || {};
          if (o.hidden) return 'Hidden';
          return '‹  ' + KIND_LABEL[kindOf()] + '  ›' + (role !== 'other' ? '   ' + role.replace(/^service:/, '') : '');
        },
        left: function () { step(-1); }, right: function () { step(1); },
        run: function () { const o = overrides()[v.Id] || {}; saveOverride(v.Id, { hidden: !o.hidden }); },
        dim: function () { return !!(overrides()[v.Id] || {}).hidden; },
      });
    });
    head('Playback');
    defs.push({
      label: 'Prefer 4K', value: function () { return store.get('pref4k', false) === true ? 'On' : 'Off'; },
      run: function () { store.set('pref4k', !(store.get('pref4k', false) === true)); },
    });
    defs.push({
      label: 'Autoplay next episode', value: function () { return bool('autoplayNext', true) ? 'On' : 'Off'; },
      run: function () { store.set('autoplayNext', !bool('autoplayNext', true)); },
    });
    const setCredits = function (dx) { store.set('player.creditMinutes', cycle(CREDIT_MINUTES, creditMinutes(store.get('player.creditMinutes', 3)), dx)); };
    defs.push({
      label: 'Mark watched near the end',
      value: function () { const m = creditMinutes(store.get('player.creditMinutes', 3)); return '‹  ' + (m ? 'Last ' + m + (m === 1 ? ' minute' : ' minutes') : 'Off') + '  ›'; },
      left: function () { setCredits(-1); }, right: function () { setCredits(1); }, run: function () { setCredits(1); },
    });
    const langs = SUB_LANGS.map(function (l) { return l[0]; });
    const setLang = function (dx) { store.set('subLang', cycle(langs, store.get('subLang', 'off'), dx)); };
    defs.push({
      label: 'Subtitles default language',
      value: function () {
        const code = store.get('subLang', 'off');
        for (let i = 0; i < SUB_LANGS.length; i++) if (SUB_LANGS[i][0] === code) return '‹  ' + SUB_LANGS[i][1] + '  ›';
        return '‹  ' + code + '  ›';
      },
      left: function () { setLang(-1); }, right: function () { setLang(1); }, run: function () { setLang(1); },
    });
    const setSize = function (dx) { store.set('player.subSize', cycle(SUBTITLE_SIZES, subtitleSize(store.get('player.subSize', 46)), dx)); };
    defs.push({
      label: 'Subtitle font size',
      value: function () { return '‹  ' + SUBTITLE_SIZE_LABELS[SUBTITLE_SIZES.indexOf(subtitleSize(store.get('player.subSize', 46)))] + '  ›'; },
      left: function () { setSize(-1); }, right: function () { setSize(1); }, run: function () { setSize(1); },
    });
    head('Diagnostics');
    defs.push({
      label: 'Performance HUD', value: function () { return hudEnabled() ? 'On' : 'Off'; },
      run: function () { setHud(!hudEnabled()); },
    });
    head('About');
    defs.push({ label: 'AIOStreams TV', value: function () { return 'Version ' + VERSION; } });
    return defs;
  }

  function build() {
    const defs = buildDefs();
    list.textContent = '';
    items = [];
    let y = 0;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (d.head) {
        const hd = h('div', 'set-head', d.head);
        hd.style.top = y + 'px';
        list.appendChild(hd);
        y += HEAD_H;
        continue;
      }
      const val = h('div', 'set-value');
      const row = h('div', 'set-row', [h('div', 'set-label', d.label), val]);
      row.style.top = y + 'px';
      list.appendChild(row);
      d.el = row; d.valEl = val; d.top = y;
      items.push(d);
      y += ROW_H;
    }
    if (index >= items.length) index = Math.max(0, items.length - 1);
    refresh();
  }

  function refresh() {
    for (let i = 0; i < items.length; i++) {
      const d = items[i];
      setText(d.valEl, d.value());
      toggleClass(d.el, 'focus', i === index);
      toggleClass(d.el, 'inert', !d.run && !d.left);
      toggleClass(d.el, 'off', !!(d.dim && d.dim()));
    }
    const cur = items[index];
    if (cur) {
      let off = 0;
      const bottom = cur.top + ROW_H;
      if (bottom > VIEW_H) off = bottom - VIEW_H + HEAD_H;
      setTransform(list, 'translateY(' + -off + 'px)');
    }
  }

  async function loadViews() {
    try {
      const r = await jellyfin.views();
      views = r && r.Items ? r.Items : [];
    } catch (e) { views = []; }
    try {
      if (typeof hubs.classify === 'function' && views.length) cls = hubs.classify(views);
    } catch (e) { cls = null; }
    if (alive) build();
  }

  function loadServerName() {
    validateServer(session.getBase()).then(function (r) {
      if (alive && r.ok) { serverName = r.name; refresh(); }
    });
  }

  build();
  loadViews();
  loadServerName();

  return {
    name: 'settings',
    el: el,
    onShow: function () { refresh(); },
    destroy: function () { alive = false; clearPending(); },
    onKey: function (action) {
      const cur = items[index];
      if (action === 'up' || action === 'down') {
        clearPending();
        index = Math.max(0, Math.min(items.length - 1, index + (action === 'up' ? -1 : 1)));
        refresh();
        return true;
      }
      if (!cur) return false;
      if (action === 'left' && cur.left) { cur.left(); refresh(); return true; }
      if (action === 'right' && cur.right) { cur.right(); refresh(); return true; }
      if (action === 'enter') { if (cur.run) { cur.run(); refresh(); } return true; }
      return action === 'left' || action === 'right';
    },
  };
}
