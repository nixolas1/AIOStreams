// On-screen display: top title gradient, bottom progress bar, pause glyph, spinner, subtitles line.
// Layout and behaviour adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0.
// Only transform and opacity are ever animated; text is rewritten at most every 900 ms.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { clock, endsAt } from '../util/format.js';

export const BAR_W = 1728;
const HIDE_MS = 4000;
const TEXT_MS = 900;

export function createOsd() {
  const el = h('div', 'osd');
  const top = h('div', 'osd-top');
  const title = h('div', 'osd-title');
  const sub = h('div', 'osd-sub');
  const src = h('div', 'osd-src');
  top.appendChild(title);
  top.appendChild(sub);
  top.appendChild(src);
  const next = h('button', 'osd-next hidden', 'Next episode  ▷|');
  next.type = 'button';
  top.appendChild(next);
  const bottom = h('div', 'osd-bottom');
  const bar = h('div', 'osd-bar');
  const fill = h('div', 'osd-fill');
  const knob = h('div', 'osd-knob');
  const seekLabel = h('div', 'osd-seek');
  knob.appendChild(seekLabel);
  bar.appendChild(fill);
  bar.appendChild(knob);
  const times = h('div', 'osd-times');
  const tNow = h('span', 'osd-now');
  const tInfo = h('span', 'osd-info');
  const tLeft = h('span', 'osd-left');
  times.appendChild(tNow);
  times.appendChild(tInfo);
  times.appendChild(tLeft);
  const hint = h('div', 'osd-hint', '▼  Audio & subtitles');
  bottom.appendChild(bar);
  bottom.appendChild(times);
  bottom.appendChild(hint);
  el.appendChild(top);
  el.appendChild(bottom);

  // Pause glyph and spinner live next to the OSD so they show with it hidden.
  const pauseBig = h('div', 'pause-big', [h('i'), h('i')]);
  const spinner = h('div', 'spinner');
  const subs = h('div', 'subs');

  let timer = 0;
  let lastText = 0;
  let paused = false;
  let on = false;
  let onChange = null;

  function setOn(v) {
    if (on === v) return;
    on = v;
    toggleClass(el, 'on', v);
    toggleClass(subs, 'lift', v);
    if (onChange) onChange(v);
  }

  const api = {
    el: el,
    pauseEl: pauseBig,
    spinnerEl: spinner,
    subsEl: subs,
    nextEl: next,
    setNext: function (available) {
      toggleClass(next, 'hidden', !available);
      toggleClass(top, 'has-next', available);
    },
    focusNext: function (focused) { toggleClass(next, 'focus', focused); },
    setSubtitleSize: function (size) { subs.style.fontSize = size + 'px'; },
    onChange: function (fn) { onChange = fn; },
    setTitles: function (t, s, source) {
      setText(title, t);
      setText(sub, s);
      setText(src, source || '');
    },
    /** Progress at ms of duration; the text part updates at most every 900 ms unless forced. */
    render: function (ms, duration, force) {
      const p = duration > 0 ? Math.max(0, Math.min(1, ms / duration)) : 0;
      setTransform(fill, 'scaleX(' + p.toFixed(4) + ')');
      setTransform(knob, 'translateX(' + Math.round(p * BAR_W) + 'px)');
      const now = Date.now();
      if (force || now - lastText >= TEXT_MS) {
        lastText = now;
        setText(tNow, clock(ms));
        setText(tLeft, duration > 0 ? '−' + clock(duration - ms) : '');
        setText(tInfo, duration > 0 ? 'Ends at ' + endsAt(duration - ms, now) : '');
      }
    },
    /** Shows the pending seek target on the knob (null hides it). */
    setPreview: function (ms) {
      toggleClass(el, 'seeking', ms != null);
      if (ms != null) setText(seekLabel, clock(ms));
    },
    show: function (sticky) {
      setOn(true);
      clearTimeout(timer);
      if (!sticky && !paused) timer = setTimeout(function () { setOn(false); }, HIDE_MS);
    },
    hide: function () {
      clearTimeout(timer);
      setOn(false);
    },
    isOn: function () { return on; },
    setPaused: function (p) {
      paused = p;
      toggleClass(pauseBig, 'on', p);
      if (p) api.show(true);
    },
    setBuffering: function (b) { toggleClass(spinner, 'on', b); },
    setSubtitle: function (text) { setText(subs, text); },
    destroy: function () { clearTimeout(timer); },
  };
  return api;
}
