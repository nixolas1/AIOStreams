import * as movieRating from '../api/movie-rating.js';
// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// A whole catalog as a virtualized poster grid, loaded 100 titles at a time.
// Yellow cycles the sort; opts.genre filters by a genre (shown as a chip).
import { h, setText, show } from '../util/dom.js';
import { createGrid } from '../ui/grid.js';
import { useAmbience } from '../ui/backdrop.js';
import { imageFor } from '../ui/tile.js';
import { prefetch } from '../ui/images.js';
import { toast } from '../ui/toast.js';
import { isFast } from '../input.js';
import * as nav from '../nav.js';
import * as jf from '../api/jellyfin.js';
import * as hubs from '../api/hubs.js';
import { metaLine } from '../util/format.js';

export const PAGE = 100;
export const SORTS = [
  { label: 'Default', sortBy: undefined, sortOrder: undefined },
  { label: 'Newest', sortBy: 'PremiereDate', sortOrder: 'Descending' },
  { label: 'Rating', sortBy: 'CommunityRating', sortOrder: 'Descending' },
  { label: 'A–Z', sortBy: 'SortName', sortOrder: 'Ascending' },
];

function add(parent, tag, cls) {
  const e = h(tag, cls);
  parent.appendChild(e);
  return e;
}

export function LibraryScreen(args) {
  const view = args.view || {};
  const genre = args.opts && args.opts.genre;
  const kind = hubs.kindOfView(view);
  const el = h('div', 'screen library');
  el.dataset.screen = 'library';
  const ambience = useAmbience();

  const head = add(el, 'header', 'lib-head');
  setText(add(head, 'h1', 'lib-title'), view.Name || 'Library');
  const genreChip = add(head, 'span', 'chip lib-genre');
  if (genre) setText(genreChip, genre); else show(genreChip, false);
  const count = add(head, 'div', 'lib-count');
  const sortEl = add(head, 'div', 'lib-sort');
  const focusInfo = add(el, 'div', 'lib-focus');
  const hint = add(el, 'div', 'lib-hint');
  hint.innerHTML = '<i class="key-yellow"></i>Sort';
  const empty = add(el, 'div', 'browse-empty lib-empty');

  let minimum = movieRating.minimum();
  let ratingSignature = movieRating.signature();
  let ratingPage;
  let sortIndex = 0;
  let pages = {};      // page -> 'loading' | 'done'
  let items = [];
  let generation = 0;
  let alive = true;
  let warned = false;
  let ready = false;

  function describe(item) {
    if (!item) { setText(focusInfo, ''); return; }
    setText(focusInfo, (item.Name || '') + (metaLine(item) ? '   ' + metaLine(item) : ''));
  }

  const grid = createGrid({
    top: 200, height: 880, total: 0,
    getItem: function (i) { return items[i]; },
    onFocus: function (item, index) {
      describe(item);
      if (!isFast()) {
        // Warm the posters of the row just past the recycled pool.
        const start = (Math.floor(index / grid.cols) + grid.poolRows - 1) * grid.cols;
        for (let i = start; i < start + grid.cols; i++) if (items[i]) prefetch(imageFor(items[i], 'Primary', 216));
      }
    },
    onSelect: function (item) { nav.go('openItem', item); },
    onNeed: function (start, end) {
      if (!ready) return;
      for (let p = Math.floor(start / PAGE); p <= Math.floor(end / PAGE); p++) loadPage(p);
    },
  });
  el.appendChild(grid.el);
  ready = true;

  function loadPage(p) {
    if (pages[p] || p < 0) return;
    if (grid.total() && p * PAGE >= grid.total()) return;
    pages[p] = 'loading';
    const gen = generation;
    const sort = SORTS[sortIndex];
    const request = ratingPage ? ratingPage({ start: p * PAGE, limit: PAGE }).then(function (r) { return { Items: r.items, TotalRecordCount: r.total }; }) : jf.items({
      parentId: view.Id, startIndex: p * PAGE, limit: PAGE,
      sortBy: sort.sortBy, sortOrder: sort.sortOrder, genres: genre,
    });
    request.then(function (r) {
      if (!alive || gen !== generation) return;
      const got = hubs.tagItems((r && r.Items) || [], kind);
      for (let i = 0; i < got.length; i++) items[p * PAGE + i] = got[i];
      pages[p] = 'done';
      if (p === 0) setText(empty, got.length ? '' : (ratingPage ? 'No movies meet this rating. Change the minimum in Settings.' : 'Nothing here yet.'));
      const total = r && r.TotalRecordCount != null ? r.TotalRecordCount : p * PAGE + got.length;
      setText(count, ratingPage ? items.filter(Boolean).length + ' matching titles loaded' : total + (total === 1 ? ' title' : ' titles'));
      if (grid.total() !== total) grid.setTotal(total);
      else grid.refresh();
      if (p === 0) describe(grid.current());
    }, function () {
      delete pages[p];
      if (!alive || gen !== generation) return;
      if (!items.length) setText(empty, 'Could not load this library. Press OK to retry.');
      if (!warned) { warned = true; toast('Could not load ' + (view.Name || 'the library')); }
    });
  }

  function reload() {
    generation++;
    pages = {};
    items = [];
    warned = false;
    const sort = SORTS[sortIndex];
    const threshold = minimum;
    const unrated = movieRating.includeUnrated();
    ratingPage = kind === 'movie' && threshold ? movieRating.pager(function (p) {
      return jf.items({ parentId: view.Id, startIndex: p.start, limit: p.limit,
        sortBy: sort.sortBy, sortOrder: sort.sortOrder, genres: genre }).then(function (r) {
        return { items: r.Items || [], total: r.TotalRecordCount == null ? (r.Items || []).length : r.TotalRecordCount };
      });
    }, function (it) { return movieRating.matches(it, threshold, unrated); }) : null;
    setText(sortEl, 'Sorted by ' + SORTS[sortIndex].label + (ratingPage ? ' · ' + movieRating.label() : ''));
    grid.reset();
    setText(focusInfo, '');
    setText(empty, '');
    loadPage(0);
  }
  reload();

  return {
    el: el,
    name: 'library',
    onShow: function () { ambience.restore(); if (ratingSignature !== movieRating.signature()) { ratingSignature = movieRating.signature(); minimum = movieRating.minimum(); reload(); } },
    onKey: function (action) {
      switch (action) {
        case 'left': grid.move(-1, 0); return true;
        case 'right': grid.move(1, 0); return true;
        case 'up': grid.move(0, -1); return true;
        case 'down': grid.move(0, 1); return true;
        case 'pageup': grid.focusIndex(grid.index() - grid.cols * 3); return true;
        case 'pagedown': grid.focusIndex(grid.index() + grid.cols * 3); return true;
        case 'enter': if (!items.length && !pages[0]) reload(); else grid.select(); return true;
        case 'play': case 'playpause': if (grid.current()) nav.go('playItem', grid.current()); return true;
        case 'yellow': sortIndex = (sortIndex + 1) % SORTS.length; reload(); return true;
        case 'back':
          if (grid.index() > grid.cols * 2) { grid.focusIndex(0); return true; }
          return false;
        default: return false;
      }
    },
    destroy: function () { alive = false; },
  };
}
