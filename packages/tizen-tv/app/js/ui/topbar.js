// Top bar: logo mark + wordmark, tabs (Home Movies Series Anime), Search and
// Settings icons, signed-in user at the right.
//
// createTopbar({current}) -> {el, focus(i), move(dx) -> bool, index(), setActive(bool), select(), current}
// `current` is 'home' | 'movies' | 'series' | 'anime'. select() on another tab
// calls nav.go('openHub', id); Search/Settings call nav.go('openSearch'/'openSettings').
import { h, toggleClass } from '../util/dom.js';
import * as nav from '../nav.js';
import * as session from '../session.js';

export const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'movies', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'anime', label: 'Anime' },
];

const MARK = '<svg viewBox="0 0 56 56" width="56" height="56"><path d="M21 15.5v25a2 2 0 0 0 3 1.7l20.5-12.5a2 2 0 0 0 0-3.4L24 13.8a2 2 0 0 0-3 1.7z" fill="#FFF7E6"/></svg>';
const SEARCH = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';
const SETTINGS = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.4"/><circle cx="9" cy="17" r="2.4"/></svg>';

export function createTopbar(o) {
  const current = (o && o.current) || 'home';
  const el = h('header', 'topbar');
  const brand = h('div', 'brand');
  const mark = h('div', 'brand-mark');
  mark.innerHTML = MARK;
  const word = h('div', 'brand-word');
  word.appendChild(document.createTextNode('AIOStreams '));
  word.appendChild(h('i', null, 'TV'));
  brand.appendChild(mark);
  brand.appendChild(word);
  el.appendChild(brand);

  const navEl = h('nav', 'nav');
  el.appendChild(navEl);
  const entries = [];
  TABS.forEach(function (t) {
    const item = h('div', 'nav-item', t.label);
    navEl.appendChild(item);
    entries.push({ id: t.id, el: item, tab: true });
  });
  navEl.appendChild(h('i', 'nav-sep'));
  [['search', SEARCH], ['settings', SETTINGS]].forEach(function (p) {
    const item = h('div', 'nav-item nav-icon');
    item.innerHTML = p[1];
    navEl.appendChild(item);
    entries.push({ id: p[0], el: item, tab: false });
  });
  const who = h('div', 'topbar-who', session.userName() || '');
  el.appendChild(who);

  let idx = 0;
  entries.forEach(function (e, i) { if (e.id === current) idx = i; });
  let active = false;

  entries.forEach(function (e) { toggleClass(e.el, 'current', e.id === current); });

  function render() {
    for (let i = 0; i < entries.length; i++) toggleClass(entries[i].el, 'focus', active && i === idx);
  }

  const api = {
    el: el,
    current: current,
    focus: function (i) { idx = Math.max(0, Math.min(entries.length - 1, i)); render(); },
    move: function (dx) {
      const next = idx + dx;
      if (next < 0 || next >= entries.length) return false;
      idx = next;
      render();
      return true;
    },
    index: function () { return idx; },
    setActive: function (on) { active = !!on; render(); },
    select: function () {
      const e = entries[idx];
      if (e.id === 'search') nav.go('openSearch');
      else if (e.id === 'settings') nav.go('openSettings');
      else if (e.id !== current) nav.go('openHub', e.id);
    },
    /** Reset focus to the current tab (when focus returns to the bar). */
    home: function () {
      entries.forEach(function (e, i) { if (e.id === current) idx = i; });
      render();
    },
  };
  return api;
}
