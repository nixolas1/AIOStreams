// Detail page for a movie, series, season (opens its series) or episode.
// Layout and zone model adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0:
// full-bleed art, text block at the left, button row, and rows below that the body slides up to
// reveal (zones: buttons | seasons | episodes | similar).
import { h, setText, setTransform, toggleClass, show } from '../util/dom.js';
import * as client from '../api/client.js';
import * as jf from '../api/jellyfin.js';
import * as session from '../session.js';
import * as hubs from '../api/hubs.js';
import * as nav from '../nav.js';
import { load as loadImage } from '../ui/images.js';
import { imageFor } from '../ui/tile.js';
import { createConfirm } from '../ui/confirm.js';
import { createRow } from '../ui/row.js';
import { toast } from '../ui/toast.js';
import { debounce } from '../util/time.js';
import { metaLine, clock, episodeLabel } from '../util/format.js';
import { createSourcesPanel } from './sources.js';
import { youtubeId } from '../platform/youtube.js';
import * as router from '../router.js';
import { TrailerScreen } from './trailer.js';
import { lastPlayed } from '../player/progress.js';

const TICKS_PER_MS = 10000;
const SECTION_TOP = 380; // where the active lower section sits once the body has slid up
const BTN_TOP = 700;

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5V2L7 6.5 12 11V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-8z"/></svg>',
  sources: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v3H3zm0 5.5h18v3H3zM3 16h18v3H3z"/></svg>',
  trailer: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm5.5 3.5v7l6-3.5z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 3h14v18l-7-4-7 4z"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 3h2v18H4zM7 3h14v12H7zm0 0v4h4V3zm8 0v4h4V3zM11 7v4h4V7zm-4 4v4h4v-4zm8 0v4h4v-4z" fill-rule="evenodd"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>',
  series: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 6h16v10H4zm4 12h8v2H8z"/></svg>',
};

function ticksMs(t) { return t ? Math.round(t / TICKS_PER_MS) : 0; }

function fetchDetail(id) {
  // Same as jellyfin.item() plus People and Taglines for the "Starring" line.
  return hubs.playbackSaved().then(function () {
    return client.get('/Items/' + id, { userId: session.userId(), Fields: jf.FIELDS_DETAIL + ',People,Taglines' });
  });
}

function isSpecial(season) { return season.IndexNumber === 0; }

export function DetailScreen(args) {
  let item = args.item;
  let alive = true;
  let shown = false;
  let inNextUp = args.from === 'nextup'; // opened from the Next up row: offer to drop the series
  let loadToken = 0;

  const el = h('div', 'screen detail');
  el.dataset.screen = 'detail';

  // art
  const art = h('div', 'detail-art');
  const backdrop = h('img', 'detail-backdrop');
  backdrop.alt = '';
  art.appendChild(backdrop);
  const scrimL = h('div', 'detail-scrim-l');
  const scrimB = h('div', 'detail-scrim-b');

  // body (slides up)
  const body = h('div', 'detail-body');
  const logoBox = h('div', 'detail-logobox');
  const logo = h('img', 'detail-logo');
  logo.alt = '';
  const title = h('h1', 'detail-title');
  logoBox.appendChild(logo);
  logoBox.appendChild(title);
  const sub = h('div', 'detail-sub');
  const meta = h('div', 'detail-meta');
  const tags = h('div', 'detail-tags');
  const summary = h('p', 'detail-summary');
  const buttonsEl = h('div', 'detail-buttons');
  const seriesButtonEl = h('div', 'detail-series-button');
  const seasonsEl = h('div', 'detail-seasons');
  const seasonsTrack = h('div', 'detail-seasons-track');
  seasonsEl.appendChild(seasonsTrack);
  body.appendChild(logoBox);
  body.appendChild(sub);
  body.appendChild(meta);
  body.appendChild(tags);
  body.appendChild(summary);
  body.appendChild(buttonsEl);
  body.appendChild(seriesButtonEl);
  body.appendChild(seasonsEl);

  el.appendChild(art);
  el.appendChild(scrimL);
  el.appendChild(scrimB);
  el.appendChild(body);

  const sources = createSourcesPanel({
    onPlay: function (it, source, info, startMs) {
      sources.close();
      nav.go('playItem', it, { startMs: startMs, sourceId: source.Id, info: info });
    },
    onClose: function () { renderFocus(); },
  });
  el.appendChild(sources.el);
  const confirm = createConfirm();
  el.appendChild(confirm.el);
  let markingSeason = false;

  // state
  let zone = 'buttons';
  let buttons = [];
  let seriesButton = null;
  let preferredEpisode = args.focusEpisode || null;
  let focusPreferredEpisode = !!preferredEpisode;
  let btnIdx = 0;
  let seasons = [];
  let seasonCount;
  let seasonIdx = 0;
  let nextEp = null;       // series: the episode Play acts on
  let firstEp = null;      // series: fallback when nothing is in progress
  let episodesRow = null;
  let episodeToken = 0;
  let similarRow = null;
  let seriesId = '';
  let preferSeason = '';
  let topSeasons = 0;
  let topEpisodes = 0;
  let topSimilar = 0;

  const isSeries = function () { return item.Type === 'Series'; };

  // ---------- header ----------

  let logoUrl = null;
  function setLogo(url) {
    if (url === logoUrl) return; // same art: its load event will not fire again
    logoUrl = url;
    logo.onload = function () { show(logo, true); show(title, false); };
    logo.onerror = function () { show(logo, false); show(title, true); };
    if (!url) { show(logo, false); show(title, true); return; }
    show(logo, false);
    show(title, false);
    loadImage(logo, url, { now: true });
  }

  function renderHeader() {
    const episode = item.Type === 'Episode';
    setText(title, episode ? item.SeriesName || item.Name || '' : item.Name || '');
    setLogo(imageFor(item, 'Logo', 640));
    setText(sub, episode ? episodeLabel(item) + (item.Name ? '   ' + item.Name : '') : (item.Taglines && item.Taglines[0]) || '');
    // This server's series ChildCount is the episode total, not the season count.
    setText(meta, metaLine(isSeries() ? Object.assign({}, item, { ChildCount: seasonCount }) : item));
    const bits = [];
    if (item.Genres && item.Genres.length) bits.push(item.Genres.slice(0, 3).join('  ·  '));
    const cast = (item.People || []).filter(function (p) { return p.Type === 'Actor'; }).slice(0, 3).map(function (p) { return p.Name; });
    if (cast.length) bits.push('Starring ' + cast.join(', '));
    setText(tags, bits.join('      '));
    setText(summary, item.Overview || '');
    loadImage(backdrop, imageFor(item, 'Backdrop', 1920), {});
  }

  // ---------- buttons ----------

  function target() {
    if (item.Type === 'Series') return nextEp || firstEp;
    return item;
  }

  function startOf(t) { return t && t.UserData ? ticksMs(t.UserData.PlaybackPositionTicks) : 0; }

  function play(t, startMs) {
    if (!t) return;
    nav.go('playItem', t, { startMs: startMs || 0 });
  }

  function addButton(list, key, icon, label, run) {
    list.push({ key: key, icon: icon, label: label, run: run });
  }

  function openTrailer() {
    const trailers = item.RemoteTrailers || [];
    let id = '';
    for (let i = 0; i < trailers.length && !id; i++) id = youtubeId(trailers[i] && trailers[i].Url);
    if (!id) { toast('No YouTube trailer for this title', 3000); return; }
    router.push(TrailerScreen({ id: id, title: item.Name }));
  }

  async function toggleFavorite() {
    const ud = item.UserData || (item.UserData = {});
    const was = !!ud.IsFavorite;
    ud.IsFavorite = !was;
    renderButtons();
    try {
      await jf.setFavorite(item.Id, !was);
    } catch (e) {
      ud.IsFavorite = was;
      renderButtons();
      toast("Couldn't update your watchlist", 3000);
    }
  }

  async function toggleWatched() {
    const ud = item.UserData || (item.UserData = {});
    const was = !!ud.Played;
    ud.Played = !was;
    if (!was) ud.PlaybackPositionTicks = 0;
    renderButtons();
    try {
      await jf.markPlayed(item.Id, !was);
      if (isSeries()) refresh();
    } catch (e) {
      ud.Played = was;
      renderButtons();
      toast("Couldn't update watched state", 3000);
    }
  }

  function markSeasonWatched() {
    const season = seasons[seasonIdx];
    if (!season || markingSeason) return;
    confirm.open({
      title: 'Mark ' + (season.Name || 'season') + ' watched?',
      sub: 'All episodes in this season will be marked as watched.',
      confirm: 'Mark watched',
      defaultConfirm: true,
      onConfirm: async function () {
        markingSeason = true;
        try {
          await jf.markPlayed(season.Id, true);
          hubs.invalidate('resume');
          hubs.invalidate('nextup');
          if (alive) { toast((season.Name || 'Season') + ' marked watched', 2500); refresh(); }
        } catch (e) {
          if (alive) { toast("Couldn't mark the season watched. Try again.", 3000); refresh(); }
        }
        markingSeason = false;
      },
    });
  }

  async function removeFromResume(t) {
    try {
      await jf.clearResume(t.Id);
    } catch (e) {
      toast("Couldn't remove it. Try again.", 3000);
      return;
    }
    const ud = t.UserData || (t.UserData = {});
    ud.PlaybackPositionTicks = 0;
    ud.PlayedPercentage = 0;
    hubs.invalidate('resume');
    toast('Removed from Continue watching', 2500);
    renderButtons();
  }

  async function removeFromNextUp() {
    const sid = item.Type === 'Series' ? item.Id : item.SeriesId;
    try {
      await jf.dropSeries(sid);
    } catch (e) {
      toast("Couldn't remove it. Try again.", 3000);
      return;
    }
    inNextUp = false;
    hubs.invalidate('nextup');
    toast('Removed from Next up', 2500);
    renderButtons();
  }

  function renderButtons() {
    const keep = buttons[btnIdx] ? buttons[btnIdx].key : '';
    const list = [];
    const t = target();
    const ud = item.UserData || {};
    if (t) {
      const pos = startOf(t);
      const lab = isSeries() ? episodeLabel(t) : '';
      if (pos > 0) {
        addButton(list, 'play', ICONS.play, 'Resume ' + clock(pos) + (lab ? '  ·  ' + lab : ''), function () { play(t, pos); });
        addButton(list, 'restart', ICONS.restart, 'From start', function () { play(t, 0); });
      } else {
        addButton(list, 'play', ICONS.play, lab ? 'Play ' + lab : 'Play', function () { play(t, 0); });
      }
      addButton(list, 'sources', ICONS.sources, 'Sources', function () { sources.open(t); renderFocus(); });
    }
    if (item.RemoteTrailers && item.RemoteTrailers.length) addButton(list, 'trailer', ICONS.trailer, 'Trailer', openTrailer);
    addButton(list, 'watchlist', ud.IsFavorite ? ICONS.check : ICONS.list, ud.IsFavorite ? 'In watchlist' : 'Watchlist', toggleFavorite);
    addButton(list, 'watched', ud.Played ? ICONS.check : ICONS.flag, ud.Played ? 'Watched' : 'Mark watched', toggleWatched);
    if (t && startOf(t) > 0) addButton(list, 'unresume', ICONS.remove, 'Remove from Continue watching', function () { removeFromResume(t); });
    if (inNextUp && (item.Type === 'Series' || (item.Type === 'Episode' && item.SeriesId))) {
      addButton(list, 'unnext', ICONS.remove, 'Remove from Next up', removeFromNextUp);
    }
    const seriesActions = [];
    if (item.Type === 'Episode' && item.SeriesId) {
      addButton(seriesActions, 'series', ICONS.series, 'Go to series', function () {
        router.push(DetailScreen({ item: { Id: item.SeriesId, Type: 'Series', Name: item.SeriesName }, focusEpisode: item }));
      });
    }
    seriesButtonEl.textContent = '';
    seriesButton = seriesActions[0] || null;
    if (seriesButton) {
      const b = h('div', 'btn detail-btn');
      b.innerHTML = seriesButton.icon;
      b.appendChild(h('span', 'btn-label', seriesButton.label));
      seriesButton.el = b;
      seriesButtonEl.appendChild(b);
    }
    buttonsEl.textContent = '';
    for (let i = 0; i < list.length; i++) {
      const b = h('div', 'btn detail-btn');
      b.innerHTML = list[i].icon;
      b.appendChild(h('span', 'btn-label', list[i].label));
      buttonsEl.appendChild(b);
      list[i].el = b;
    }
    buttons = list;
    let at = 0;
    for (let i = 0; i < list.length; i++) if (list[i].key === keep) at = i;
    btnIdx = at;
    renderFocus();
  }

  // ---------- seasons / episodes / similar ----------

  function renderSeasons() {
    seasonsTrack.textContent = '';
    if (seasons.length < 2) return;
    for (let i = 0; i < seasons.length; i++) {
      const p = h('div', 'pill', seasons[i].Name || 'Season ' + seasons[i].IndexNumber);
      seasonsTrack.appendChild(p);
      seasons[i]._el = p;
    }
  }

  // Vertical layout of the lower sections, in body coordinates (the body slides up to bring the
  // active section's top to SECTION_TOP).
  function layout() {
    const hasPills = seasons.length > 1;
    let y = BTN_TOP + 72 + 52 + (seriesButton ? 96 : 0);
    topSeasons = y;
    seasonsEl.style.top = y + 'px';
    if (hasPills) y += 56 + 28;
    topEpisodes = hasPills ? topSeasons : y;
    if (episodesRow) {
      // The episodes row has no title: pull it up by the title's height.
      episodesRow.el.style.top = (y - 52) + 'px';
      y += episodesRow.height - 64 + 40;
    }
    topSimilar = y;
    if (similarRow) similarRow.el.style.top = y + 'px';
  }

  function ensureEpisodesRow() {
    if (episodesRow) return;
    episodesRow = createRow({
      kind: 'episode',
      title: '',
      onSelect: function (ep) { play(ep, startOf(ep)); },
    });
    body.appendChild(episodesRow.el);
    layout();
  }

  function focusEpisode(eps) {
    let at = -1;
    if (preferredEpisode) for (let i = 0; i < eps.length; i++) if (eps[i].Id === preferredEpisode.Id || (eps[i].ParentIndexNumber === preferredEpisode.ParentIndexNumber && eps[i].IndexNumber === preferredEpisode.IndexNumber)) at = i;
    if (at < 0 && nextEp) for (let i = 0; i < eps.length; i++) if (eps[i].Id === nextEp.Id) at = i;
    if (at < 0) for (let i = 0; i < eps.length; i++) if (!(eps[i].UserData && eps[i].UserData.Played)) { at = i; break; }
    episodesRow.setIndex(at >= 0 ? at : 0);
  }

  async function loadEpisodes(season, keepFocus) {
    const mine = ++episodeToken;
    try {
      const r = await jf.episodes(seriesId, season.Id);
      if (!alive || mine !== episodeToken) return;
      const eps = (r && r.Items) || [];
      ensureEpisodesRow();
      const at = episodesRow.index();
      episodesRow.setItems(eps);
      if (keepFocus) episodesRow.setIndex(at);
      else focusEpisode(eps);
      if (focusPreferredEpisode && eps.length) { zone = 'episodes'; focusPreferredEpisode = false; }
      if (!firstEp && eps.length && !isSpecial(season)) { firstEp = eps[0]; renderButtons(); }
      renderFocus();
    } catch (e) {
      if (alive && mine === episodeToken) toast("Couldn't load the episodes", 3000);
    }
  }

  const loadEpisodesSoon = debounce(function () {
    if (seasons[seasonIdx]) loadEpisodes(seasons[seasonIdx], false);
  }, 180);

  function ensureSimilarRow() {
    if (similarRow) return;
    similarRow = createRow({
      kind: 'poster',
      title: 'More like this',
      onSelect: function (it) { nav.go('openItem', it); },
    });
    body.appendChild(similarRow.el);
    layout();
  }

  async function loadSimilar() {
    try {
      const r = await jf.similar(item.Id, 20);
      if (!alive) return;
      const list = (r && r.Items) || [];
      if (!list.length) return;
      ensureSimilarRow();
      similarRow.setItems(list);
      layout();
    } catch (e) { /* the row is optional */ }
  }

  // ---------- focus ----------

  function zones() {
    const z = ['buttons'];
    if (seriesButton) z.push('series');
    if (seasons.length > 1) z.push('seasons');
    if (episodesRow && episodesRow.count()) z.push('episodes');
    if (similarRow && similarRow.count()) z.push('similar');
    return z;
  }

  function sectionTop(z) {
    if (z === 'seasons') return topSeasons;
    if (z === 'episodes') return topEpisodes;
    if (z === 'similar') return topSimilar;
    return 0;
  }

  function renderFocus() {
    if (zone !== 'buttons' && zones().indexOf(zone) < 0) zone = 'buttons';
    const panelOpen = sources.isOpen();
    if (seriesButton) toggleClass(seriesButton.el, 'focus', zone === 'series' && !panelOpen);
    for (let i = 0; i < buttons.length; i++) toggleClass(buttons[i].el, 'focus', zone === 'buttons' && !panelOpen && i === btnIdx);
    // A long row (Resume, Remove from ...) slides left so the focused button stays inside the 96 px margin.
    const fb = buttons[btnIdx] && buttons[btnIdx].el;
    if (fb) {
      if (fb._right == null) fb._right = fb.offsetLeft + fb.offsetWidth; // buttons never move: measure once
      setTransform(buttonsEl, 'translateX(' + -Math.max(0, fb._right - 1728) + 'px)');
    }
    for (let i = 0; i < seasons.length; i++) {
      if (!seasons[i]._el) continue;
      toggleClass(seasons[i]._el, 'focus', zone === 'seasons' && i === seasonIdx);
      toggleClass(seasons[i]._el, 'current', i === seasonIdx);
    }
    // Long season lists scroll so the current pill stays inside the 1728 px strip.
    const cur = seasons[seasonIdx] && seasons[seasonIdx]._el;
    if (cur) {
      if (cur._right == null) cur._right = cur.offsetLeft + cur.offsetWidth; // pills never move: measure once
      setTransform(seasonsTrack, 'translateX(' + -Math.max(0, cur._right - 1728 + 60) + 'px)');
    }
    if (episodesRow) episodesRow.setActive(zone === 'episodes' && !panelOpen);
    if (similarRow) similarRow.setActive(zone === 'similar' && !panelOpen);
    const shift = zone === 'buttons' ? 0 : Math.max(0, sectionTop(zone) - SECTION_TOP);
    setTransform(body, 'translateY(' + -shift + 'px)');
    toggleClass(el, 'shifted', zone !== 'buttons' && zone !== 'series');
  }

  function moveZone(dir) {
    const z = zones();
    const i = z.indexOf(zone) + dir;
    if (i < 0 || i >= z.length) return false;
    zone = z[i];
    renderFocus();
    return true;
  }

  // ---------- loading ----------

  async function load(silent) {
    const mine = ++loadToken;
    try {
      let full = await fetchDetail(item.Id);
      if (!alive || mine !== loadToken) return;
      if (full.Type === 'Season') {
        preferSeason = full.Id;
        seriesId = full.SeriesId;
        full = await fetchDetail(full.SeriesId);
        if (!alive || mine !== loadToken) return;
      }
      item = full;
      seriesId = item.Type === 'Series' ? item.Id : seriesId;
      renderHeader();
      renderButtons();
      if (item.Type === 'Series') {
        const res = await Promise.all([jf.seasons(item.Id), jf.nextUp({ seriesId: item.Id, limit: 1 }).catch(function () { return null; }),
          preferredEpisode ? jf.episodes(item.Id).catch(function () { return null; }) : Promise.resolve(null)]);
        if (!alive || mine !== loadToken) return;
        seasons = ((res[0] && res[0].Items) || []).filter(function (s) { return s.Type === 'Season' || !s.Type; });
        seasonCount = seasons.filter(function (s) { return !isSpecial(s); }).length;
        renderHeader();
        const history = (res[2] && res[2].Items) || [];
        for (let i = 0; i < history.length; i++) if (lastPlayed(history[i]) > lastPlayed(preferredEpisode || {})) preferredEpisode = history[i];
        nextEp = res[1] && res[1].Items && res[1].Items[0] ? res[1].Items[0] : null;
        if (!silent || !seasons[seasonIdx]) {
          let at = -1;
          if (preferSeason) for (let i = 0; i < seasons.length; i++) if (seasons[i].Id === preferSeason) at = i;
          if (at < 0 && preferredEpisode) for (let i = 0; i < seasons.length; i++) if (seasons[i].Id === preferredEpisode.SeasonId || (preferredEpisode.ParentIndexNumber != null && seasons[i].IndexNumber === preferredEpisode.ParentIndexNumber)) at = i;
          if (at < 0 && nextEp) for (let i = 0; i < seasons.length; i++) if (seasons[i].Id === nextEp.SeasonId || (nextEp.ParentIndexNumber != null && seasons[i].IndexNumber === nextEp.ParentIndexNumber)) at = i;
          if (at < 0) for (let i = 0; i < seasons.length; i++) if (!isSpecial(seasons[i])) { at = i; break; }
          seasonIdx = at >= 0 ? at : 0;
        }
        renderSeasons();
        renderButtons();
        layout();
        if (seasons[seasonIdx]) await loadEpisodes(seasons[seasonIdx], silent);
      }
      if (!silent && item.Type !== 'Episode') loadSimilar();
      layout();
      renderFocus();
    } catch (e) {
      if (alive && mine === loadToken && !silent) setText(summary, "Couldn't load the details. Press Back and try again.");
    }
  }

  function refresh() { load(true); }

  // first paint from what the caller already has
  renderHeader();
  layout();
  renderButtons();

  // ---------- keys ----------

  function playFocused() {
    if (zone === 'episodes' && episodesRow && episodesRow.item()) {
      const ep = episodesRow.item();
      play(ep, startOf(ep));
    } else if (zone === 'similar' && similarRow && similarRow.item()) {
      nav.go('openItem', similarRow.item());
    } else {
      const t = target();
      if (t) play(t, startOf(t));
    }
  }

  return {
    name: 'detail',
    longEnter: true,
    el: el,
    onShow: function () {
      if (shown) refresh();
      else load(false);
      shown = true;
    },
    onKey: function (action) {
      if (confirm.isOpen()) return confirm.onKey(action);
      if (sources.isOpen()) return sources.onKey(action);
      if (action === 'up') { if (zone !== 'buttons') moveZone(-1); return true; }
      if (action === 'down') { moveZone(1); return true; }
      if (action === 'play' || action === 'playpause') { playFocused(); return true; }
      if (zone === 'buttons') {
        if (action === 'left') { if (btnIdx > 0) { btnIdx--; renderFocus(); } return true; }
        if (action === 'right') { if (btnIdx < buttons.length - 1) { btnIdx++; renderFocus(); } return true; }
        if (action === 'enter') { if (buttons[btnIdx]) buttons[btnIdx].run(); return true; }
      } else if (zone === 'series') {
        if (action === 'enter' && seriesButton) { seriesButton.run(); return true; }
      } else if (zone === 'seasons') {
        if (action === 'longenter') { markSeasonWatched(); return true; }
        if (action === 'left' || action === 'right') {
          const n = seasonIdx + (action === 'right' ? 1 : -1);
          if (n >= 0 && n < seasons.length) { seasonIdx = n; renderFocus(); loadEpisodesSoon(); }
          return true;
        }
        if (action === 'enter') { moveZone(1); return true; }
      } else if (zone === 'episodes') {
        if (action === 'left') { episodesRow.move(-1); return true; }
        if (action === 'right') { episodesRow.move(1); return true; }
        if (action === 'longenter') {
          const ep = episodesRow.item();
          if (ep) nav.go('openItem', ep);
          return true;
        }
        if (action === 'enter') { episodesRow.select(); return true; }
      } else if (zone === 'similar') {
        if (action === 'left') { similarRow.move(-1); return true; }
        if (action === 'right') { similarRow.move(1); return true; }
        if (action === 'enter') { similarRow.select(); return true; }
      }
      if (action === 'back' && zone !== 'buttons') { zone = 'buttons'; renderFocus(); return true; }
      return false;
    },
    destroy: function () {
      alive = false;
      loadEpisodesSoon.cancel();
      confirm.close();
      sources.destroy();
      if (episodesRow) episodesRow.destroy();
      if (similarRow) similarRow.destroy();
    },
  };
}
