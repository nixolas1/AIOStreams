// Sources: right-hand panel listing an item's versions (MediaSources) so the viewer can pick
// one. Detail embeds the panel; nav 'openSources' wraps it in a screen of its own.
// Panel structure adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// (list with a stationary focus and a transform-driven track).
// Request shapes follow packages/web/src/components/version-picker.tsx: opening the list asks
// the server to search anew (Fresh); Red refreshes (Refresh) and bypasses its cache.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import * as store from '../util/store.js';
import * as jf from '../api/jellyfin.js';
import * as nav from '../nav.js';
import * as router from '../router.js';
import { toast } from '../ui/toast.js';
import { rankSources, nameLines, pickSource } from '../player/pick.js';
import { lastSourceKey } from './player.js';

const TICKS_PER_MS = 10000;
const ROW_PITCH = 140;
const VIEW_H = 780;

function resumeMs(item) {
  const ud = item && item.UserData;
  return ud && ud.PlaybackPositionTicks ? Math.round(ud.PlaybackPositionTicks / TICKS_PER_MS) : 0;
}

function chip(text, kind) {
  return h('span', 'src-chip' + (kind ? ' ' + kind : ''), text);
}

/**
 * createSourcesPanel({onPlay(item, source, info, startMs), onClose()}) ->
 *   {el, open(item), close(), isOpen(), onKey(action) -> bool, destroy()}
 */
export function createSourcesPanel(handlers) {
  const el = h('div', 'sources');
  const dim = h('div', 'sources-dim');
  const panel = h('div', 'sources-panel');
  const title = h('div', 'sources-title', 'Sources');
  const sub = h('div', 'sources-sub');
  const clip = h('div', 'sources-clip');
  const track = h('div', 'sources-track');
  const status = h('div', 'sources-status');
  const hint = h('div', 'sources-hint', 'OK  Play   ·   Red  Search again   ·   Back  Close');
  clip.appendChild(track);
  panel.appendChild(title);
  panel.appendChild(sub);
  panel.appendChild(clip);
  panel.appendChild(status);
  panel.appendChild(hint);
  el.appendChild(dim);
  el.appendChild(panel);

  let item = null;
  let info = null;
  let rows = [];       // [{el, judged}]
  let idx = 0;
  let opened = false;
  let token = 0;
  let closeTimer = 0;
  let loading = false;
  let best = null;

  function showStatus(msg) {
    setText(status, msg || '');
    toggleClass(status, 'on', !!msg);
  }

  function paint() {
    for (let i = 0; i < rows.length; i++) toggleClass(rows[i].el, 'focus', i === idx);
    const first = Math.max(0, Math.min(idx - 2, Math.max(0, rows.length - Math.floor(VIEW_H / ROW_PITCH))));
    setTransform(track, 'translateY(' + (-first * ROW_PITCH) + 'px)');
  }

  function build(list) {
    track.textContent = '';
    rows = [];
    const remembered = item ? store.get(lastSourceKey(item.Id), null) : null;
    best = pickSource(list.map(function (j) { return j.source; }));
    let focusAt = -1;
    for (let i = 0; i < list.length; i++) {
      const j = list[i];
      const lines = nameLines(j.source);
      const text = h('div', 'src-text', [
        h('div', 'src-l1', lines[0]),
        lines[1] ? h('div', 'src-l2', lines[1]) : null,
        lines[2] ? h('div', 'src-l3', lines.slice(2).join('  ·  ')) : null,
      ]);
      const chips = h('div', 'src-chips');
      if (j.source === best && j.playable) chips.appendChild(chip('Recommended', 'good'));
      for (let r = 0; r < j.reasons.length; r++) chips.appendChild(chip(j.reasons[r], j.playable ? 'warn' : 'bad'));
      const isLast = remembered && j.source.Id === remembered;
      if (isLast && focusAt < 0) focusAt = i;
      const row = h('div', 'src-row' + (j.playable ? '' : ' dim'), [
        h('div', 'src-mark', isLast ? '✓' : ''),
        text,
        chips,
      ]);
      setTransform(row, 'translateY(' + i * ROW_PITCH + 'px)');
      track.appendChild(row);
      rows.push({ el: row, judged: j });
    }
    track.style.height = list.length * ROW_PITCH + 'px';
    idx = focusAt >= 0 ? focusAt : 0;
    paint();
  }

  async function load(refresh) {
    const mine = ++token;
    loading = true;
    track.textContent = '';
    rows = [];
    showStatus('Searching for sources…');
    setText(sub, item ? item.Name || '' : '');
    try {
      const r = await jf.playbackInfo(item.Id, refresh ? { refresh: true } : {});
      if (mine !== token) return;
      loading = false;
      info = r;
      const all = (r && r.MediaSources) || [];
      const real = all.filter(function (s) { return s.Type !== 'Placeholder'; });
      const notices = all.filter(function (s) { return s.Type === 'Placeholder'; });
      const ranked = rankSources(real);
      if (!ranked.length) {
        const note = notices.length && notices[0].Name ? String(notices[0].Name).split('\n')[0] : 'No sources found for this title';
        showStatus(note + '. Press Red to search again.');
        setText(sub, item.Name || '');
        return;
      }
      showStatus('');
      let playable = 0;
      for (let i = 0; i < ranked.length; i++) if (ranked[i].playable) playable++;
      setText(sub, (item.Name || '') + '   ·   ' + ranked.length + (ranked.length === 1 ? ' version' : ' versions') +
        (playable < ranked.length ? ', ' + playable + ' the TV can play' : ''));
      build(ranked);
    } catch (e) {
      if (mine !== token) return;
      loading = false;
      showStatus((e && e.message ? e.message : "Couldn't load the sources") + '. Press Red to try again.');
    }
  }

  function choose() {
    const r = rows[idx];
    if (!r || !item) return;
    if (!r.judged.playable) toast('The TV may not be able to play this one.', 3000);
    store.set(lastSourceKey(item.Id), r.judged.source.Id);
    if (handlers.onPlay) handlers.onPlay(item, r.judged.source, info, resumeMs(item));
  }

  const api = {
    el: el,
    isOpen: function () { return opened; },
    open: function (it) {
      item = it;
      clearTimeout(closeTimer);
      opened = true;
      el.classList.add('open');
      void el.offsetWidth;
      el.classList.add('in');
      load(false);
    },
    close: function () {
      if (!opened) return;
      opened = false;
      token++;
      el.classList.remove('in');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(function () { el.classList.remove('open'); }, 280);
      if (handlers.onClose) handlers.onClose();
    },
    onKey: function (action) {
      if (!opened) return false;
      if (action === 'back') { api.close(); return true; }
      if (action === 'red') { if (!loading) load(true); return true; }
      if (action === 'up') { if (idx > 0) { idx--; paint(); } return true; }
      if (action === 'down') { if (idx < rows.length - 1) { idx++; paint(); } return true; }
      if (action === 'enter' || action === 'play' || action === 'playpause') { choose(); return true; }
      return true;
    },
    destroy: function () { token++; clearTimeout(closeTimer); },
  };
  return api;
}

/** nav 'openSources': the panel on a screen of its own (Back closes it). */
export function SourcesScreen(args) {
  const el = h('div', 'screen screen-sources');
  el.dataset.screen = 'sources';
  const panel = createSourcesPanel({
    onPlay: function (item, source, info, startMs) {
      nav.go('playItem', item, { startMs: startMs, sourceId: source.Id, info: info });
    },
    onClose: function () { router.back(); },
  });
  el.appendChild(panel.el);
  return {
    name: 'sources',
    el: el,
    onShow: function () { if (!panel.isOpen()) panel.open(args.item); },
    onKey: function (action) { return panel.onKey(action); },
    destroy: function () { panel.destroy(); },
  };
}
