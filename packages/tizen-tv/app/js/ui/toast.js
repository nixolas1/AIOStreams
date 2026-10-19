// Tiny transient message at the bottom of the screen: toast('Could not load Trending').
import { h } from '../util/dom.js';

let el = null;
let timer = 0;

export function toast(text, ms) {
  if (typeof document === 'undefined') return;
  if (!el) {
    el = h('div', 'toast', null);
    document.body.appendChild(el);
  }
  el.textContent = String(text);
  // Next frame so the opacity transition always runs.
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(timer);
  timer = setTimeout(function () { el.classList.remove('on'); }, ms || 3200);
}
