// Playback screen. Direct play only (AIOStreams has no transcoder): pick a source the TV can
// decode, play it through AVPlay (<video> on desktop), draw our own OSD and subtitles, report
// progress to the Jellyfin session endpoints.
// Structure adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0: seek preview
// that commits after a pause, OSD, track picker, up-next countdown.
import { h } from '../util/dom.js';
import * as store from '../util/store.js';
import * as client from '../api/client.js';
import * as jf from '../api/jellyfin.js';
import * as router from '../router.js';
import { createPlayer } from '../platform/player.js';
import { setScreenSaver, isUhdPanel } from '../platform/tizen.js';
import { episodeLabel } from '../util/format.js';
import { toast } from '../ui/toast.js';
import { pickSource, nextSource, nameLines, isUhd, rankSources } from '../player/pick.js';
import { parseCues, CueTrack } from '../player/subtitles.js';
import { Seeker, COMMIT_MS } from '../player/seek.js';
import { createOsd } from '../player/osd.js';
import { createTracksPanel, chooseAudio, audioLabel, subtitleLabel, sameLang, langCode } from '../player/tracks.js';

const TICKS_PER_MS = 10000;
const PROGRESS_MS = 10000;
const UPNEXT_SECONDS = 10;
const SUBTITLE_POLL_MS = 120;

/** The last version each item played in; shared with screens/sources.js. */
export function lastSourceKey(itemId) { return 'src.' + itemId; }

function isRealSource(s) { return s && s.Type !== 'Placeholder'; }

function externalSubtitles(source) {
  const out = [];
  const all = (source && source.MediaStreams) || [];
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    if (s.Type === 'Subtitle' && (s.IsExternal || s.DeliveryMethod === 'External') && s.DeliveryUrl) out.push(s);
  }
  return out;
}

function subtitleHref(stream) {
  const raw = String(stream.DeliveryUrl);
  const vtt = raw.replace(/Stream\.\w+(?=\?|$)/, 'Stream.vtt');
  return /^https?:\/\//i.test(vtt) ? vtt : client.url(vtt);
}

export function PlayerScreen(args) {
  const opts = args.opts || {};
  let item = args.item;

  const el = h('div', 'screen player');
  el.dataset.screen = 'player';
  const stage = h('div', 'player-stage');
  const osd = createOsd();
  const errorBox = h('div', 'player-error hidden');
  const upnext = h('div', 'upnext hidden');
  const panel = createTracksPanel({
    onChoose: choose,
    onClose: function () { if (!paused) osd.show(); },
  });
  el.appendChild(stage);
  el.appendChild(osd.subsEl);
  el.appendChild(osd.spinnerEl);
  el.appendChild(osd.pauseEl);
  el.appendChild(osd.el);
  el.appendChild(panel.el);
  el.appendChild(upnext);
  el.appendChild(errorBox);

  let info = null;          // PlaybackInfo response in use
  let sources = [];         // real (non-placeholder) sources
  let current = null;       // source being played
  let gen = 0;              // bumps per open; stale callbacks are ignored
  let triedFallback = false;
  let alive = true;
  let began = false;
  let started = false;
  let paused = false;
  let seeking = false;
  let stopped = false;
  let reportedStart = false;
  let position = 0;
  let duration = 0;
  let nextItem = null;
  let nextLoaded = false;
  let ended = false;
  let failedState = false;
  let panelData = null;

  // tracks
  let audioTracks = [];
  let embeddedText = [];
  let subList = [];         // [{id, kind:'emb'|'ext', label, lang, ref}]
  let subId = 'off';
  let subTouched = false;
  let cueTrack = null;
  let cueFor = '';
  let subTimer = 0;
  let embTimer = 0;

  let progressTimer = 0;
  let commitTimer = 0;
  let upnextTimer = 0;
  const seeker = new Seeker({ commitMs: COMMIT_MS });

  const player = createPlayer(stage, {
    onTime: function (ms) {
      if (!started || seeking || !alive) return;
      position = ms;
      if (!seeker.pending()) osd.render(position, duration, false);
    },
    onBuffering: function (b) { if (alive) osd.setBuffering(b || (!started && !failedState && !ended)); },
    onEnd: function () { if (alive) finished(); },
    onError: function (msg) { if (alive) failed(msg, gen); },
    onSubtitle: function (text, ms) {
      if (!alive || subId.indexOf('emb:') !== 0) return;
      clearTimeout(embTimer);
      osd.setSubtitle(plain(text));
      if (ms > 0) embTimer = setTimeout(function () { osd.setSubtitle(''); }, ms);
    },
  });
  function plain(t) {
    return String(t || '').replace(/\{\\[^}]*\}/g, '').replace(/<[^>]*>/g, '').replace(/\\N/g, '\n').trim();
  }

  // ---------- titles ----------

  function renderTitles() {
    const src = current ? nameLines(current)[0] : '';
    if (item.Type === 'Episode') {
      osd.setTitles(item.SeriesName || item.Name, episodeLabel(item) + (item.Name ? '   ' + item.Name : ''), src);
    } else {
      osd.setTitles(item.Name, item.ProductionYear ? String(item.ProductionYear) : '', src);
    }
  }

  // ---------- reporting ----------

  function body(extra) {
    const o = {
      ItemId: item.Id,
      MediaSourceId: current ? current.Id : undefined,
      PlaySessionId: info ? info.PlaySessionId : undefined,
      PositionTicks: Math.round(position) * TICKS_PER_MS,
      IsPaused: paused,
      CanSeek: true,
      PlayMethod: 'DirectPlay',
    };
    if (extra) for (const k in extra) o[k] = extra[k];
    return o;
  }

  function swallow(p) { if (p && p.catch) p.catch(function () {}); }

  function reportStart() {
    reportedStart = true;
    swallow(jf.reportStart(body()));
    clearInterval(progressTimer);
    progressTimer = setInterval(function () { reportProgress('TimeUpdate'); }, PROGRESS_MS);
  }

  function reportProgress(event) {
    if (!reportedStart || stopped) return;
    swallow(jf.reportProgress(body({ EventName: event })));
  }

  function reportStop() {
    clearInterval(progressTimer);
    if (!reportedStart || stopped) return;
    stopped = true;
    swallow(jf.reportStopped(body()));
  }

  // ---------- opening ----------

  function resumeMs() {
    if (opts.startMs != null) return opts.startMs;
    const ud = item.UserData;
    return ud && ud.PlaybackPositionTicks ? Math.round(ud.PlaybackPositionTicks / TICKS_PER_MS) : 0;
  }

  async function begin() {
    if (began) return;
    began = true;
    osd.setBuffering(true);
    osd.show(true);
    renderTitles();
    osd.render(0, durationFromItem(), true);
    try {
      info = opts.info && opts.info.MediaSources ? opts.info : null;
      if (!info) info = await jf.playbackInfo(item.Id, { kept: true });
      if (!alive) return;
      const all = (info && info.MediaSources) || [];
      sources = all.filter(isRealSource);
      if (!sources.length) {
        const note = all.length && all[0].Name ? String(all[0].Name).split('\n')[0] : '';
        throw new Error(note || 'No sources were found for this title');
      }
      const startMs = resumeMs();
      const wanted = opts.sourceId || (startMs > 0 ? store.get(lastSourceKey(item.Id), null) : null);
      let src = null;
      for (let i = 0; i < sources.length; i++) if (wanted && sources[i].Id === wanted) src = sources[i];
      if (!src && store.get('pref4k', false) === true) {
        // Settings > Prefer 4K: the first clean playable UHD version, else the usual pick.
        const ranked = rankSources(sources);
        for (let i = 0; i < ranked.length && !src; i++) if (ranked[i].playable && !ranked[i].warn && isUhd(ranked[i].source)) src = ranked[i].source;
      }
      if (!src) src = pickSource(sources);
      loadNext();
      await openSource(src, startMs);
    } catch (e) {
      failed(e && e.message ? e.message : String(e), gen);
    }
  }

  function durationFromItem() {
    return item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MS) : 0;
  }

  async function openSource(src, atMs) {
    const mine = ++gen;
    current = src;
    started = false;
    failedState = false;
    seeking = false;
    ended = false;
    errorBox.classList.add('hidden');
    osd.setBuffering(true);
    renderTitles();
    resetSubtitles();
    const url = client.directUrl(item.Id, src, info ? info.PlaySessionId : undefined);
    player.open(url, { uhd: isUhd(src) && isUhdPanel() });
    let r;
    try {
      r = await player.prepare();
    } catch (e) {
      if (mine === gen) failed(e && e.message ? e.message : String(e), mine);
      return;
    }
    if (!alive || mine !== gen) return;
    duration = (r && r.durationMs) || durationFromItem();
    setupTracks(mine);
    position = atMs || 0;
    if (atMs > 0) {
      seeking = true;
      try { await player.seek(atMs); } catch (e) { /* start from where it is */ }
      seeking = false;
      if (!alive || mine !== gen) return;
    }
    player.play();
    paused = false;
    started = true;
    osd.setPaused(false);
    osd.setBuffering(false);
    osd.render(position, duration, true);
    osd.show();
    reportStart();
    store.set(lastSourceKey(item.Id), src.Id);
  }

  function failed(msg, g) {
    if (!alive || g !== gen || failedState) return;
    // One automatic fallback to the next playable source.
    if (!triedFallback && current && sources.length > 1) {
      const next = nextSource(sources, current);
      if (next) {
        triedFallback = true;
        toast('That source failed. Trying the next one.', 3500);
        player.close();
        openSource(next, position).catch(function (e) { failed(e && e.message ? e.message : String(e), gen); });
        return;
      }
    }
    failedState = true;
    started = false;
    osd.setBuffering(false);
    osd.hide();
    clearInterval(progressTimer);
    errorBox.textContent = '';
    errorBox.appendChild(h('div', 'player-error-title', "Can't play this"));
    errorBox.appendChild(h('div', 'player-error-msg', String(msg || 'Playback failed')));
    errorBox.appendChild(h('div', 'player-error-hint', 'OK  Try again   ·   Back  Exit'));
    errorBox.classList.remove('hidden');
  }

  function retry() {
    if (!current) { began = false; begin(); return; }
    triedFallback = true;
    player.close();
    openSource(current, position).catch(function (e) { failed(e && e.message ? e.message : String(e), gen); });
  }

  // ---------- tracks & subtitles ----------

  function resetSubtitles() {
    clearInterval(subTimer);
    clearTimeout(embTimer);
    cueTrack = null;
    cueFor = '';
    osd.setSubtitle('');
    subId = 'off';
    audioTracks = [];
    embeddedText = [];
    subList = [];
  }

  function rebuildSubList() {
    const list = [];
    for (let i = 0; i < embeddedText.length; i++) {
      list.push({ id: 'emb:' + embeddedText[i].id, kind: 'emb', lang: embeddedText[i].lang, ref: embeddedText[i],
        label: subtitleLabel({ lang: embeddedText[i].lang }, i + 1) + '  ·  embedded' });
    }
    const ext = externalSubtitles(current);
    for (let i = 0; i < ext.length; i++) {
      list.push({ id: 'ext:' + ext[i].Index, kind: 'ext', lang: ext[i].Language, ref: ext[i], label: subtitleLabel(ext[i], list.length + 1) });
    }
    subList = list;
  }

  function setupTracks(mine) {
    const t = player.tracks();
    audioTracks = t.audio;
    embeddedText = t.text;
    // Samsung TVs cannot decode DTS: prefer a decodable track in the same language.
    const pref = store.get('player.audioLang', '');
    const want = chooseAudio(audioTracks, player.currentAudio(), pref);
    if (want != null && want !== player.currentAudio()) player.selectAudio(want);
    player.selectText(null);
    rebuildSubList();
    autoSubtitle();
    // Naming a version also gets its subtitles from subtitle addons: ask in the background.
    const src = current;
    jf.playbackInfo(item.Id, { sourceId: src.Id }).then(function (r) {
      if (!alive || mine !== gen || !r || !r.MediaSources) return;
      let m = null;
      for (let i = 0; i < r.MediaSources.length; i++) if (r.MediaSources[i].Id === src.Id) m = r.MediaSources[i];
      if (!m) m = r.MediaSources[0];
      if (m && m.MediaStreams && externalSubtitles(m).length > externalSubtitles(src).length) {
        src.MediaStreams = m.MediaStreams;
        rebuildSubList();
        autoSubtitle();
      }
    }, function () {});
  }

  function autoSubtitle() {
    if (subTouched || subId !== 'off') return;
    let lang = store.get('player.subLang', null);
    if (lang == null) lang = store.get('subLang', 'off'); // Settings default until the viewer picks one
    if (!lang || lang === 'off') return;
    for (let i = 0; i < subList.length; i++) {
      if (sameLang(subList[i].lang, lang)) { applySubtitle(subList[i]); return; }
    }
  }

  function applySubtitle(opt) {
    clearInterval(subTimer);
    clearTimeout(embTimer);
    cueTrack = null;
    cueFor = '';
    osd.setSubtitle('');
    if (!opt) {
      subId = 'off';
      player.selectText(null);
      return;
    }
    subId = opt.id;
    if (opt.kind === 'emb') {
      player.selectText(opt.ref.id);
      return;
    }
    // External text: AVPlay draws nothing, so we fetch and draw it.
    player.selectText(null);
    const id = opt.id;
    cueFor = id;
    fetch(subtitleHref(opt.ref)).then(function (r) { return r.ok ? r.text() : ''; }).then(function (txt) {
      if (!alive || cueFor !== id) return;
      cueTrack = new CueTrack(parseCues(txt));
      if (!cueTrack.cues.length) toast('Those subtitles are empty', 2500);
    }, function () {
      if (alive && cueFor === id) toast("Couldn't load the subtitles", 3000);
    });
    subTimer = setInterval(function () {
      if (cueTrack && started && !seeking) osd.setSubtitle(cueTrack.textAt(player.time()));
    }, SUBTITLE_POLL_MS);
  }

  function openPanel() {
    if (!current) return;
    const cur = player.currentAudio();
    const audio = audioTracks.map(function (a, i) { return { label: audioLabel(a, i + 1), on: a.id === cur, ref: a }; });
    const subs = [{ label: 'Off', on: subId === 'off', ref: null }];
    for (let i = 0; i < subList.length; i++) subs.push({ label: subList[i].label, on: subList[i].id === subId, ref: subList[i] });
    osd.hide();
    panel.open({ audio: audio, subs: subs });
    panelData = { audio: audio, subs: subs };
  }
  function choose(col, index) {
    const opt = panelData && panelData[col === 0 ? 'audio' : 'subs'][index];
    if (!opt) return;
    if (col === 0) {
      player.selectAudio(opt.ref.id);
      store.set('player.audioLang', langCode(opt.ref.lang));
    } else {
      subTouched = true;
      applySubtitle(opt.ref);
      store.set('player.subLang', opt.ref ? (langCode(opt.ref.lang) || 'off') : 'off');
    }
    panel.close();
  }

  // ---------- controls ----------

  function togglePause() {
    if (!started) return;
    if (paused) {
      player.play();
      paused = false;
      osd.setPaused(false);
      osd.show();
      reportProgress('Unpause');
    } else {
      player.pause();
      paused = true;
      osd.setPaused(true);
      reportProgress('Pause');
    }
  }

  function seekBy(dir) {
    if (!started || !duration) return;
    const target = seeker.press(dir, Date.now(), position, duration);
    osd.setPreview(target);
    osd.render(target, duration, true);
    osd.show(true);
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitSeek, COMMIT_MS);
  }

  async function commitSeek() {
    clearTimeout(commitTimer);
    const t = seeker.commit();
    if (t == null) return;
    osd.setPreview(null);
    position = t;
    const mine = gen;
    seeking = true;
    osd.setBuffering(true);
    try { await player.seek(t); } catch (e) { /* closed or failed: the error listener reports */ }
    seeking = false;
    if (!alive || mine !== gen) return;
    osd.setBuffering(false);
    osd.render(position, duration, true);
    osd.show();
    reportProgress('TimeUpdate');
  }

  function cancelSeek() {
    clearTimeout(commitTimer);
    seeker.cancel();
    osd.setPreview(null);
    osd.render(position, duration, true);
  }

  // ---------- ending / up next ----------

  async function loadNext() {
    if (nextLoaded || item.Type !== 'Episode' || !item.SeriesId) return;
    nextLoaded = true;
    try {
      const r = await jf.episodes(item.SeriesId);
      const eps = (r && r.Items) || [];
      for (let i = 0; i < eps.length; i++) {
        if (eps[i].Id === item.Id && i + 1 < eps.length) { nextItem = eps[i + 1]; break; }
      }
    } catch (e) { nextItem = null; }
  }

  async function finished() {
    if (ended) return;
    ended = true;
    started = false;
    position = duration;
    clearTimeout(commitTimer);
    clearInterval(subTimer);
    osd.setSubtitle('');
    reportStop();
    player.close();
    osd.setBuffering(false);
    osd.hide();
    if (item.Type === 'Episode' && !nextLoaded) await loadNext();
    if (!alive) return;
    if (!nextItem) { exit(); return; }
    // Settings > Autoplay next episode off: show the card but wait for OK instead of counting down.
    const auto = store.get('autoplayNext', true) !== false;
    let left = UPNEXT_SECONDS;
    const render = function () {
      upnext.textContent = '';
      upnext.appendChild(h('div', 'upnext-label', auto ? 'Up next in ' + left : 'Up next'));
      upnext.appendChild(h('div', 'upnext-title', (episodeLabel(nextItem) ? episodeLabel(nextItem) + '   ' : '') + (nextItem.Name || '')));
      upnext.appendChild(h('div', 'upnext-series', nextItem.SeriesName || ''));
      upnext.appendChild(h('div', 'upnext-hint', 'OK  Play now   ·   Back  Exit'));
    };
    render();
    upnext.classList.remove('hidden');
    if (!auto) return;
    upnextTimer = setInterval(function () {
      left--;
      if (left <= 0) playNext();
      else render();
    }, 1000);
  }

  function playNext() {
    clearInterval(upnextTimer);
    if (!nextItem) return;
    router.replace(PlayerScreen({ item: nextItem, opts: { startMs: 0 } }));
  }

  function exit() {
    if (router.top() && router.top().el === el) router.back();
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    reportStop();
    clearTimeout(commitTimer);
    clearInterval(subTimer);
    clearTimeout(embTimer);
    clearInterval(upnextTimer);
    clearInterval(progressTimer);
    osd.destroy();
    player.destroy();
    document.documentElement.classList.remove('playing');
    setScreenSaver(true);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function onVisibility() {
    if (!alive) return;
    if (document.hidden) {
      if (started && !paused) togglePause();
      player.suspend();
    } else {
      player.restore();
    }
  }

  // ---------- screen ----------

  return {
    name: 'player',
    el: el,
    onShow: function () {
      document.documentElement.classList.add('playing');
      setScreenSaver(false);
      document.addEventListener('visibilitychange', onVisibility);
      begin();
    },
    onKey: function (action) {
      if (!upnext.classList.contains('hidden')) {
        if (action === 'enter' || action === 'right') playNext();
        else if (action === 'back' || action === 'stop') exit();
        return true;
      }
      if (panel.isOpen()) return panel.onKey(action);
      if (failedState) {
        if (action === 'enter') retry();
        else if (action === 'back' || action === 'stop') exit();
        return true;
      }
      switch (action) {
        case 'enter':
          if (seeker.pending()) commitSeek();
          else if (osd.isOn() || paused) togglePause();
          else osd.show();
          return true;
        case 'playpause':
          if (seeker.pending()) commitSeek();
          else togglePause();
          return true;
        case 'play': if (paused) togglePause(); return true;
        case 'pause': if (!paused) togglePause(); return true;
        case 'left': case 'rw': seekBy(-1); return true;
        case 'right': case 'ff': seekBy(1); return true;
        case 'up': case 'info': osd.show(paused || seeker.pending()); return true;
        case 'down': openPanel(); return true;
        case 'stop': exit(); return true;
        case 'back':
          if (seeker.pending()) { cancelSeek(); osd.show(); return true; }
          if (osd.isOn()) { osd.hide(); return true; }
          exit();
          return true;
        default: return true;
      }
    },
    destroy: teardown,
  };
}
