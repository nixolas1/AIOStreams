// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0 (search layout and zones)
// Search: input | chips (recent searches) | result rows (Movies, Series, Anime).
// A search runs only when the field is committed (OK / Done) or a recent chip is picked: the server's
// TMDB search is slow (2 to 30 s) and per-keystroke requests made it time out.
import { h, setText, setTransform, show, toggleClass } from '../util/dom.js';
import * as store from '../util/store.js';
import * as jellyfin from '../api/jellyfin.js';
import * as nav from '../nav.js';
import { createField } from '../ui/keyboard.js';
import * as rowUi from '../ui/row.js';   // namespace import: tolerates a missing createRow
import * as hubs from '../api/hubs.js';

const MAX_RECENT = 8;
const MIN_CHARS = 2;
const SEARCH_AGAIN = 'Press OK on the search box to try again.';
const PROVIDER_ANIME = /kitsu|anilist|mal|anidb/i;

/** Anime heuristics when api/hubs.js has no per-item helper. */
export function looksLikeAnime(item) {
  if (!item) return false;
  const genres = item.Genres || [];
  let anime = false;
  let animation = false;
  for (let i = 0; i < genres.length; i++) {
    const g = String(genres[i]).toLowerCase();
    if (g === 'anime') anime = true;
    if (g === 'animation') animation = true;
  }
  if (anime) return true;
  if (animation && item.ProviderIds) {
    for (const k in item.ProviderIds) if (PROVIDER_ANIME.test(k)) return true;
  }
  return false;
}

/** Split results into Movies / Series / Anime groups (empty groups dropped). */
export function groupResults(items, isAnime) {
  const test = isAnime || looksLikeAnime;
  const g = { Movies: [], Series: [], Anime: [] };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (test(it)) g.Anime.push(it);
    else if (it.Type === 'Series') g.Series.push(it);
    else g.Movies.push(it);
  }
  const out = [];
  if (g.Movies.length) out.push({ title: 'Movies', items: g.Movies });
  if (g.Series.length) out.push({ title: 'Series', items: g.Series });
  if (g.Anime.length) out.push({ title: 'Anime', items: g.Anime });
  return out;
}

export function addRecent(list, term) {
  term = String(term || '').trim();
  if (term.length < MIN_CHARS) return list;
  const out = [term];
  for (let i = 0; i < list.length && out.length < MAX_RECENT; i++) {
    if (String(list[i]).toLowerCase() !== term.toLowerCase()) out.push(list[i]);
  }
  return out;
}

/** Copy for a failed search: timeouts and unreachable servers get their own wording. */
export function errorCopy(e) {
  const status = e && e.status;
  const msg = e && e.message;
  if (status === 0 && msg === 'Timed out') return { title: 'Search timed out', sub: SEARCH_AGAIN };
  if (status === 0) return { title: 'Could not reach the server', sub: SEARCH_AGAIN };
  return { title: 'Search failed', sub: 'Could not reach the server. Try again.' };
}

export function SearchScreen() {
  let zone = 'input'; // 'input' | 'chips' | 'rows'
  let chipIndex = 0;
  let rowIndex = 0;
  let rows = [];       // [{row, wrap, title}]
  let chips = [];      // [{label, run}]
  let seq = 0;
  let pitch = 500;
  let term = '';
  let alive = true;
  let recents = store.get('recentSearches', []);
  if (!Array.isArray(recents)) recents = [];

  const field = createField({
    placeholder: 'Search movies, series and anime',
    onInput: function (v) { term = v; },
    onDone: function (v) {
      const t = String(v).trim();
      if (t.length >= MIN_CHARS) search(t);
    },
  });
  field.el.className += ' search-field';

  const chipLabel = h('div', 'search-chip-label', 'Recent searches');
  const chipRow = h('div', 'search-chips');
  const empty = h('div', 'search-empty', [
    h('div', 'search-empty-title', 'Search movies, series and anime'),
    h('div', 'search-empty-sub', 'Press OK on the search box to type with the on-screen keyboard.'),
  ]);
  const rowsClip = h('div', 'search-rows');
  const rowsTrack = h('div', 'rows-track search-rows-track');
  rowsClip.appendChild(rowsTrack);
  const el = h('div', { class: 'screen screen-search', dataset: { screen: 'search' } }, [
    h('div', 'search-title', 'Search'),
    field.el, chipLabel, chipRow, empty, rowsClip,
  ]);

  function pushRecent(t) {
    recents = addRecent(recents, t);
    store.set('recentSearches', recents);
  }

  function setChips(list) {
    chips = list;
    chipRow.textContent = '';
    for (let i = 0; i < list.length; i++) {
      list[i].el = h('div', 'chip search-chip', list[i].label);
      chipRow.appendChild(list[i].el);
    }
    show(chipLabel, list.length > 0);
    if (chipIndex >= list.length) chipIndex = Math.max(0, list.length - 1);
    paint();
  }

  function recentChips() {
    const list = recents.map(function (t) { return { label: t, run: function () { useTerm(t); } }; });
    if (list.length) list.push({ label: 'Clear', run: function () { recents = []; store.set('recentSearches', []); chipIndex = 0; setChips(recentChips()); if (!chips.length) setZone('input'); } });
    return list;
  }

  function useTerm(t) {
    field.setValue(t);
    search(t);
  }

  // Commit: remember the term, run exactly one search, move into the results when there are some.
  function search(t) {
    term = t;
    pushRecent(t);
    setChips(recentChips());
    run(t).then(function () { if (rows.length && alive) setZone('rows'); });
  }

  function clearRows() {
    for (let i = 0; i < rows.length; i++) {
      try { rows[i].row.destroy(); } catch (e) { /* ignore */ }
    }
    rows = [];
    rowsTrack.textContent = '';
    rowIndex = 0;
    setTransform(rowsTrack, 'translateY(0px)');
  }

  function showEmpty(title, sub) {
    setText(empty.firstChild, title);
    setText(empty.lastChild, sub);
    show(empty, true);
  }

  async function run(t) {
    t = String(t || '').trim();
    const my = ++seq;
    if (t.length < MIN_CHARS) {
      clearRows();
      showEmpty('Search movies, series and anime', 'Press OK on the search box to type with the on-screen keyboard.');
      setChips(recentChips());
      return;
    }
    clearRows();
    showEmpty('Searching for "' + t + '"…', 'The server is looking. This can take a few seconds.');
    let res;
    try {
      res = await jellyfin.items({ searchTerm: t, includeItemTypes: 'Movie,Series', limit: 40 });
    } catch (e) {
      if (my !== seq) return;
      clearRows();
      const copy = errorCopy(e);
      showEmpty(copy.title, copy.sub);
      return;
    }
    if (my !== seq || !alive) return;
    const groups = groupResults(res && res.Items ? res.Items : [], typeof hubs.kindOf === 'function' ? function (it) { return hubs.kindOf(it) === 'anime' || looksLikeAnime(it); } : null);
    clearRows();
    if (!groups.length) {
      showEmpty('No results for "' + t + '"', 'Check the spelling or try a shorter title.');
      return;
    }
    show(empty, false);
    const createRow = rowUi.createRow;
    if (typeof createRow !== 'function') { showEmpty('Results unavailable', 'The browse components are not loaded.'); return; }
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const row = createRow({
        kind: 'poster', title: g.title,
      });
      pitch = row.height + 6;
      row.setItems(g.items);
      const wrap = h('div', 'search-rowwrap', [row.el]);
      wrap.style.transform = 'translateY(' + i * pitch + 'px)';
      rowsTrack.appendChild(wrap);
      rows.push({ row: row, wrap: wrap });
    }
    paint();
  }

  function setZone(z) {
    zone = z;
    paint();
  }

  function paint() {
    field.setFocused(zone === 'input');
    for (let i = 0; i < chips.length; i++) toggleClass(chips[i].el, 'focus', zone === 'chips' && i === chipIndex);
    for (let i = 0; i < rows.length; i++) rows[i].row.setActive(zone === 'rows' && i === rowIndex);
    // Keep the active row at the top of the results area.
    setTransform(rowsTrack, 'translateY(' + (-rowIndex * pitch) + 'px)');
  }

  setChips(recentChips());
  paint();

  return {
    name: 'search',
    el: el,
    onShow: function () { paint(); },
    destroy: function () { alive = false; seq++; clearRows(); },
    onKey: function (action) {
      if (field.handleKey(action)) return true;
      if (zone === 'input') {
        if (action === 'down') {
          if (chips.length) setZone('chips'); else if (rows.length) setZone('rows');
          return true;
        }
        return action === 'up' || action === 'left' || action === 'right';
      }
      if (zone === 'chips') {
        if (action === 'left') { if (chipIndex > 0) { chipIndex--; paint(); } return true; }
        if (action === 'right') { if (chipIndex < chips.length - 1) { chipIndex++; paint(); } return true; }
        if (action === 'up') { setZone('input'); return true; }
        if (action === 'down') { if (rows.length) setZone('rows'); return true; }
        if (action === 'enter') { if (chips[chipIndex]) chips[chipIndex].run(); return true; }
        return false;
      }
      // rows
      const cur = rows[rowIndex];
      if (!cur) { setZone('input'); return true; }
      if (action === 'left' || action === 'right') { cur.row.move(action === 'left' ? -1 : 1); return true; }
      if (action === 'up') {
        if (rowIndex > 0) { rowIndex--; paint(); } else setZone(chips.length ? 'chips' : 'input');
        return true;
      }
      if (action === 'down') { if (rowIndex < rows.length - 1) { rowIndex++; paint(); } return true; }
      if (action === 'enter') {
        const item = cur.row.item();
        if (item) { pushRecent(term); nav.go('openItem', item); }
        return true;
      }
      return false;
    },
  };
}
