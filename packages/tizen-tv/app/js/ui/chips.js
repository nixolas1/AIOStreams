// Horizontal row of pills (genre chips). Same row-like interface as ui/row.js so
// the browse page can treat both alike; focus is drawn by inverting the pill.
//
// createChips({title, items:[{label, value}], onSelect(value, item)}) ->
//   {el, height, move(dx) -> bool, setIndex(i), index(), item(), count(), select(), setActive(bool), setItems(items), destroy()}
function add(parent, tag, cls) {
  const e = h(tag, cls);
  parent.appendChild(e);
  return e;
}
import { h, setText, setTransform, toggleClass } from '../util/dom.js';

const LEFT = 96;
const GAP = 14;
const HEIGHT = 64 + 52 + 24;

// Fixed widths (Inter 600 24px averages ~13px a glyph) so no measuring is needed.
function widthOf(label) {
  return 56 + Math.round(String(label).length * 13.2);
}

export function createChips(o) {
  let items = [];
  let idx = 0;
  let active = false;
  let offsets = [];
  let scroll = 0;
  const el = h('section', 'row row-chips');
  const titleEl = add(el, 'h2', 'row-title');
  titleEl.textContent = o.title || '';
  const clip = add(el, 'div', 'row-clip');
  clip.style.height = '76px';
  const track = add(clip, 'div', 'row-track chips-track');
  let pills = [];

  function build() {
    track.textContent = '';
    pills = [];
    offsets = [];
    let x = 0;
    for (let i = 0; i < items.length; i++) {
      const w = widthOf(items[i].label);
      const p = add(track, 'div', 'pill chip-pill');
      p.style.width = w + 'px';
      p.style.transform = 'translateX(' + x + 'px)';
      p.textContent = items[i].label;
      offsets.push(x);
      pills.push(p);
      x += w + GAP;
    }
    offsets.push(x);
  }

  function render() {
    for (let i = 0; i < pills.length; i++) toggleClass(pills[i], 'focus', active && i === idx);
    if (!pills.length) return;
    const left = offsets[idx];
    const right = left + widthOf(items[idx].label);
    const room = 1920 - LEFT * 2;
    if (left < scroll) scroll = left;
    else if (right > scroll + room) scroll = right - room;
    setTransform(track, 'translateX(' + (-scroll) + 'px)');
  }

  const api = {
    el: el,
    height: HEIGHT,
    setItems: function (next) {
      items = next || [];
      idx = Math.min(idx, Math.max(0, items.length - 1));
      scroll = 0;
      build();
      render();
    },
    move: function (dx) {
      const next = idx + dx;
      if (next < 0 || next >= items.length) return false;
      idx = next;
      render();
      return true;
    },
    setIndex: function (i) { idx = Math.max(0, Math.min(items.length - 1, i)); render(); },
    index: function () { return idx; },
    item: function () { return items[idx]; },
    items: function () { return items; },
    count: function () { return items.length; },
    select: function () {
      if (o.onSelect && items[idx]) o.onSelect(items[idx].value, items[idx]);
    },
    setTitle: function (t) { setText(titleEl, t); },
    setActive: function (on) {
      active = on;
      toggleClass(el, 'active', on);
      render();
    },
    destroy: function () { if (el.parentNode) el.parentNode.removeChild(el); },
  };
  api.setItems(o.items || []);
  return api;
}
