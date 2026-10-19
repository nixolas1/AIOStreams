// Video backend. Samsung AVPlay (hardware decode, drawn on a plane under the web layer) on the
// TV, an HTML5 <video> in a desktop browser. Same interface for both.
// Structure adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0; the Samsung
// quirks (seek serialisation, silent subtitles, AV object order) follow
// packages/web/src/lib/hosts/tizen/player.ts.
//
// listener: { onTime(ms), onBuffering(bool), onEnd(), onError(message), onSubtitle(text, durationMs) }
//
// backend: {
//   kind: 'avplay' | 'video',
//   open(url, {uhd}), prepare() -> Promise<{durationMs}>, play(), pause(), seek(ms) -> Promise,
//   time() -> ms, duration() -> ms, state() -> 'PLAYING'|'PAUSED'|'READY'|'IDLE'|'NONE',
//   tracks() -> {audio:[Track], text:[Track]}, currentAudio() -> id|null,
//   selectAudio(id) -> bool, selectText(id|null) -> bool,
//   suspend(), restore(), close(), destroy()
// }
// Track: { id, lang, codec, label? }   (id is the AVPlay track index)

function hasAvPlay() {
  try { return !!(window.webapis && window.webapis.avplay); } catch (e) { return false; }
}

function errorText(e) {
  const code = String((e && e.name) || e);
  if (/CONNECTION|NETWORK|INVALID_URI|TIMEOUT|URI/i.test(code)) return 'The TV could not load the stream';
  if (/NOT_SUPPORTED|UNSUPPORTED|FORMAT/i.test(code)) return 'The TV cannot play this format';
  return "The TV's player failed (" + code + ')';
}

function avplayBackend(container, listener) {
  const av = window.webapis.avplay;
  const obj = document.createElement('object');
  obj.type = 'application/avplayer';
  obj.className = 'av-object';
  container.appendChild(obj);

  let opened = false;
  // No other call may reach AVPlay until a seek reports back.
  let seeking = false;
  let nextSeek = null;
  let waiters = [];
  let queued = [];
  let lastTime = 0;

  function run(fn) {
    if (seeking) queued.push(fn);
    else fn();
  }

  function doSeek(ms) {
    seeking = true;
    const done = function (err) {
      seeking = false;
      if (nextSeek != null) {
        const n = nextSeek;
        nextSeek = null;
        doSeek(n);
        return;
      }
      const q = queued;
      queued = [];
      for (let i = 0; i < q.length; i++) { try { q[i](); } catch (e) { /* ignore */ } }
      const w = waiters;
      waiters = [];
      for (let i = 0; i < w.length; i++) { if (err) w[i].rej(err); else w[i].res(); }
    };
    lastTime = ms;
    try {
      av.seekTo(ms, function () { done(null); }, function (e) { done(new Error(errorText(e))); });
    } catch (e) {
      done(new Error(errorText(e)));
    }
  }

  function info(t) {
    let x = {};
    try { x = JSON.parse(t.extra_info) || {}; } catch (e) { x = {}; }
    return x;
  }

  const api = {
    kind: 'avplay',
    open: function (url, o) {
      api.close();
      av.open(url);
      opened = true;
      av.setListener({
        onbufferingstart: function () { listener.onBuffering(true); },
        onbufferingprogress: function () {},
        onbufferingcomplete: function () { listener.onBuffering(false); },
        oncurrentplaytime: function (ms) { lastTime = ms; listener.onTime(ms); },
        onstreamcompleted: function () { listener.onEnd(); },
        onerror: function (e) { listener.onError(errorText(e)); },
        onevent: function () {},
        onsubtitlechange: function (duration, text) { listener.onSubtitle(String(text || ''), Number(duration) || 0); },
        ondrmevent: function () {},
      });
      // AVPlay places its picture in a 1920x1080 space, whatever the panel.
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      if (o && o.uhd) {
        try { av.setStreamingProperty('SET_MODE_4K', 'TRUE'); } catch (e) { /* not a UHD panel */ }
      }
    },
    prepare: function () {
      return new Promise(function (resolve, reject) {
        av.prepareAsync(function () {
          let d = 0;
          try { d = av.getDuration(); } catch (e) { d = 0; }
          resolve({ durationMs: d });
        }, function (e) { reject(new Error(errorText(e))); });
      });
    },
    play: function () { run(function () { av.play(); }); },
    pause: function () { run(function () { av.pause(); }); },
    seek: function (ms) {
      const target = Math.max(0, Math.floor(ms));
      return new Promise(function (res, rej) {
        waiters.push({ res: res, rej: rej });
        if (seeking) nextSeek = target;
        else doSeek(target);
      });
    },
    time: function () {
      if (seeking) return lastTime;
      try { lastTime = av.getCurrentTime(); } catch (e) { /* keep last */ }
      return lastTime;
    },
    duration: function () {
      try { return av.getDuration(); } catch (e) { return 0; }
    },
    state: function () {
      try { return av.getState(); } catch (e) { return 'NONE'; }
    },
    tracks: function () {
      let all = [];
      try { all = av.getTotalTrackInfo() || []; } catch (e) { all = []; }
      const audio = [];
      const text = [];
      for (let i = 0; i < all.length; i++) {
        const x = info(all[i]);
        const t = { id: all[i].index, lang: x.language || x.track_lang || '', codec: x.fourCC || '' };
        if (all[i].type === 'AUDIO') audio.push(t);
        else if (all[i].type === 'TEXT') text.push(t);
      }
      return { audio: audio, text: text };
    },
    currentAudio: function () {
      try {
        const cur = av.getCurrentStreamInfo() || [];
        for (let i = 0; i < cur.length; i++) if (cur[i].type === 'AUDIO') return cur[i].index;
      } catch (e) { /* ignore */ }
      return null;
    },
    selectAudio: function (id) {
      let ok = true;
      run(function () { try { av.setSelectTrack('AUDIO', id); } catch (e) { ok = false; } });
      return ok;
    },
    selectText: function (id) {
      let ok = true;
      run(function () {
        try {
          if (id == null) { av.setSilentSubtitle(true); return; }
          av.setSelectTrack('TEXT', id);
          av.setSilentSubtitle(false);
        } catch (e) { ok = false; }
      });
      return ok;
    },
    suspend: function () { try { av.suspend(); } catch (e) { /* ignore */ } },
    restore: function () { try { av.restore(); } catch (e) { /* ignore */ } },
    close: function () {
      if (!opened) return;
      opened = false;
      seeking = false;
      nextSeek = null;
      queued = [];
      const w = waiters;
      waiters = [];
      for (let i = 0; i < w.length; i++) w[i].rej(new Error('closed'));
      // While AVPlay is still open, or its subtitle layer can stay on screen.
      try { av.setSilentSubtitle(true); } catch (e) { /* ignore */ }
      try { av.setListener({}); } catch (e) { /* ignore */ }
      try { if (av.getState() !== 'NONE' && av.getState() !== 'IDLE') av.stop(); } catch (e) { /* ignore */ }
      try { av.close(); } catch (e) { /* ignore */ }
    },
    destroy: function () {
      api.close();
      if (obj.parentNode) obj.parentNode.removeChild(obj);
    },
  };
  return api;
}

function videoBackend(container, listener) {
  const v = document.createElement('video');
  v.className = 'av-object';
  v.setAttribute('playsinline', '');
  container.appendChild(v);
  let live = true;

  v.addEventListener('timeupdate', function () { if (live) listener.onTime(v.currentTime * 1000); });
  v.addEventListener('waiting', function () { if (live) listener.onBuffering(true); });
  v.addEventListener('playing', function () { if (live) listener.onBuffering(false); });
  v.addEventListener('ended', function () { if (live) listener.onEnd(); });
  v.addEventListener('error', function () {
    if (!live || !v.getAttribute('src')) return;
    listener.onError('The browser could not play this stream' + (v.error ? ' (' + v.error.code + ')' : ''));
  });

  return {
    kind: 'video',
    open: function (url) { live = true; v.src = url; },
    prepare: function () {
      return new Promise(function (resolve, reject) {
        const ok = function () { v.removeEventListener('error', bad); resolve({ durationMs: v.duration * 1000 || 0 }); };
        const bad = function () { v.removeEventListener('loadedmetadata', ok); reject(new Error('The browser could not load the stream')); };
        v.addEventListener('loadedmetadata', ok, { once: true });
        v.addEventListener('error', bad, { once: true });
        v.load();
      });
    },
    play: function () { const p = v.play(); if (p && p.catch) p.catch(function () {}); },
    pause: function () { v.pause(); },
    seek: function (ms) {
      return new Promise(function (resolve) {
        v.addEventListener('seeked', function () { resolve(); }, { once: true });
        v.currentTime = Math.max(0, ms / 1000);
        setTimeout(resolve, 1500);
      });
    },
    time: function () { return v.currentTime * 1000; },
    duration: function () { return isFinite(v.duration) ? v.duration * 1000 : 0; },
    state: function () { return v.paused ? 'PAUSED' : 'PLAYING'; },
    tracks: function () { return { audio: [], text: [] }; },
    currentAudio: function () { return null; },
    selectAudio: function () { return false; },
    selectText: function () { return false; },
    suspend: function () { v.pause(); },
    restore: function () {},
    close: function () { live = false; v.removeAttribute('src'); try { v.load(); } catch (e) { /* ignore */ } },
    destroy: function () {
      live = false;
      v.removeAttribute('src');
      if (v.parentNode) v.parentNode.removeChild(v);
    },
  };
}

export function createPlayer(container, listener) {
  return hasAvPlay() ? avplayBackend(container, listener) : videoBackend(container, listener);
}
