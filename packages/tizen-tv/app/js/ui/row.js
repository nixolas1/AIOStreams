// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Horizontal, virtualized row. Focus is anchored at the left edge: the track
// slides under a stationary focus ring, so every move is one compositor-only
// transform and the ring never repaints.
//
// createRow({kind, title, onFocus(item, index), onSelect(item, index), onNeedMore(), kindBadge})
//   -> {el, height, setItems, appendItems, move(dx) -> bool, setIndex(i), index(), item(),
//       items(), count(), select(), setTitle(t), setActive(bool), destroy()}
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { createTile, fillTile, KINDS, CAPTION_H } from './tile.js';
import { cancel } from './images.js';

export const GAP = 28;
export const LEFT = 96;
export const BEHIND = 2; // tiles kept to the left of focus (one is peeking on screen)
export const NEED_MORE = 6;

/** Pool geometry: how many tile nodes a row of this tile width needs. */
export function poolSizeFor(tileWidth) {
  const step = tileWidth + GAP;
  return Math.ceil((1920 - LEFT) / step) + BEHIND + 2;
}

/** Which item indexes [first, last) the pool covers when `index` has focus. */
export function poolWindow(index, count, poolSize) {
  const first = Math.max(0, Math.min(index, Math.max(0, count - 1)) - BEHIND);
  return { first: first, last: Math.min(count, first + poolSize) };
}

/** Pool slot that holds item i (stable while i stays in the window). */
export function slotOf(i, poolSize) {
  return i % poolSize;
}

/** translateX of the track for a focused index. */
export function trackX(index, step) {
  return -index * step;
}

export function rowHeight(kind, hasTitle) {
  const size = KINDS[kind];
  return (hasTitle === false ? 0 : 64) + size.h + (size.caption ? CAPTION_H : 0) + 24;
}

function add(parent, tag, cls) {
  const e = h(tag, cls);
  parent.appendChild(e);
  return e;
}

export function createRow(o) {
  const kind = o.kind || 'poster';
  const size = KINDS[kind];
  const step = size.w + GAP;
  const capH = size.caption ? CAPTION_H : 0;
  const poolSize = poolSizeFor(size.w);
  let items = [];
  let idx = 0;

  const el = h('section', 'row');
  const titleEl = add(el, 'h2', 'row-title');
  setText(titleEl, o.title || '');
  const clip = add(el, 'div', 'row-clip');
  clip.style.height = (size.h + capH + 24) + 'px';
  const track = add(clip, 'div', 'row-track');
  const ring = add(clip, 'div', 'ring');
  ring.style.left = (LEFT - 8) + 'px';
  ring.style.top = '4px';
  ring.style.width = (size.w + 16) + 'px';
  ring.style.height = (size.h + 16) + 'px';

  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    const tile = createTile(kind, { kindBadge: o.kindBadge });
    tile._i = -1;
    tile.style.visibility = 'hidden';
    track.appendChild(tile);
    pool.push(tile);
  }

  function render() {
    const win = poolWindow(idx, items.length, poolSize);
    for (let i = win.first; i < win.last; i++) {
      const tile = pool[slotOf(i, poolSize)];
      if (tile._i !== i) {
        tile._i = i;
        setTransform(tile, 'translateX(' + i * step + 'px)');
        tile.style.visibility = '';
      }
      fillTile(tile, items[i], kind);
    }
    for (let k = 0; k < poolSize; k++) {
      const tile = pool[k];
      if (tile._i !== -1 && (tile._i < win.first || tile._i >= win.last)) {
        tile._i = -1;
        tile.style.visibility = 'hidden';
      }
    }
    setTransform(track, 'translateX(' + trackX(idx, step) + 'px)');
  }

  function wipe() {
    for (let k = 0; k < poolSize; k++) { pool[k]._i = -1; pool[k]._t.item = undefined; }
  }

  function focused() {
    if (o.onFocus && items[idx]) o.onFocus(items[idx], idx);
    if (o.onNeedMore && items.length - idx <= NEED_MORE) o.onNeedMore();
  }

  const api = {
    el: el,
    height: rowHeight(kind, true),
    kind: kind,
    setItems: function (next) {
      // Keep focus on the same item when the list is refreshed.
      const cur = items[idx];
      items = next || [];
      let at = -1;
      if (cur) for (let i = 0; i < items.length; i++) if (items[i].Id === cur.Id) { at = i; break; }
      idx = at >= 0 ? at : Math.min(idx, Math.max(0, items.length - 1));
      wipe();
      render();
    },
    appendItems: function (more) {
      if (!more || !more.length) return;
      items = items.concat(more);
      render();
    },
    move: function (dx) {
      const next = idx + dx;
      if (next < 0 || next >= items.length) return false;
      idx = next;
      render();
      focused();
      return true;
    },
    /** Silent: moves focus without firing onFocus. */
    setIndex: function (i) {
      idx = Math.max(0, Math.min(items.length - 1, i));
      render();
    },
    index: function () { return idx; },
    item: function () { return items[idx]; },
    items: function () { return items; },
    count: function () { return items.length; },
    select: function () {
      if (o.onSelect && items[idx]) o.onSelect(items[idx], idx);
    },
    setTitle: function (t) { setText(titleEl, t); },
    setActive: function (on) {
      toggleClass(el, 'active', on);
      toggleClass(ring, 'on', on);
    },
    destroy: function () {
      for (let k = 0; k < poolSize; k++) cancel(pool[k]._t.img);
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
  return api;
}
