// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0 (fps overlay idea)
// Tiny performance HUD: frames per second over the last 500 ms and the worst
// frame time in that window. Costs one rAF callback while enabled, nothing otherwise.
import * as store from '../util/store.js';
import { h } from '../util/dom.js';

let el = null;
let running = false;
let last = 0;
let frames = 0;
let worst = 0;
let windowStart = 0;

function tick(now) {
  if (!running) return;
  if (last) {
    const dt = now - last;
    if (dt > worst) worst = dt;
    frames++;
  }
  last = now;
  if (!windowStart) windowStart = now;
  if (now - windowStart >= 500) {
    const fps = Math.round((frames * 1000) / (now - windowStart));
    if (el) el.textContent = fps + ' fps  ·  worst ' + Math.round(worst) + ' ms';
    frames = 0; worst = 0; windowStart = now;
  }
  requestAnimationFrame(tick);
}

export function hudEnabled() {
  return store.get('hud', false) === true;
}

function start() {
  if (running) return;
  if (!el) {
    el = h('div', { class: 'hud', text: '-- fps' });
    document.body.appendChild(el);
  }
  el.style.display = '';
  running = true; last = 0; frames = 0; worst = 0; windowStart = 0;
  requestAnimationFrame(tick);
}

function stop() {
  running = false;
  if (el) el.style.display = 'none';
}

export function setHud(on) {
  store.set('hud', !!on);
  if (on) start(); else stop();
}

// Call once at boot: shows the HUD again if it was left on.
export function initHud() {
  if (hudEnabled()) start();
}
