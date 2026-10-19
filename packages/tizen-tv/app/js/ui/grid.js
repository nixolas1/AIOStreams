// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Vertical, virtualized poster grid for whole catalogs.
// Each pooled row is its own compositor layer, so scrolling only re-rasterizes
// the row that gets recycled with new posters. The track moves by transform;
// the focus ring moves inside the track.
//
// createGrid({cols=7, kind='grid', top, height, total, getItem(i), onFocus(item,i), onSelect(item,i), onNeed(start,end)})
//   -> {el, move(dx,dy) -> bool, focusIndex(i), index(), current(), select(), setTotal(n), refresh(), reset(), total(), cols, poolRows}
import { h, setTransform } from '../util/dom.js';
import { createTile, fillTile, KINDS, CAPTION_H } from './tile.js';

export const GAP_X = 41;
export const GAP_Y = 28;

/** Row geometry for a focused index: the focused row sits second from the top. */
export function gridWindow(index, cols, total, poolRows) {
  const rowCount = Math.ceil(total / cols);
  const focusRow = Math.floor(index / cols);
  const scrollRow = Math.max(0, focusRow - 1);
  const firstRow = Math.max(0, scrollRow - 1);
  const lastRow = Math.min(rowCount, firstRow + poolRows);
  return { rowCount: rowCount, focusRow: focusRow, scrollRow: scrollRow, firstRow: firstRow, lastRow: lastRow };
}

/** Target index for a d-pad move (or -1 when the move is not possible). */
export function gridMove(index, dx, dy, cols, total) {
  const col = index % cols;
  let next = index;
  if (dx) {
    if (col + dx < 0 || col + dx >= cols) return -1;
    next += dx;
  }
  if (dy) next += dy * cols;
  if (next < 0) return -1;
  if (next >= total) {
    // Down into a short last row lands on its last item.
    if (dy > 0 && Math.floor(next / cols) < Math.ceil(total / cols)) next = total - 1;
    else return -1;
  }
  return next === index ? -1 : next;
}

function add(parent, tag, cls) {
  const e = h(tag, cls);
  parent.appendChild(e);
  return e;
}

export function createGrid(o) {
  const cols = o.cols || 7;
  const kind = o.kind || 'grid';
  const size = KINDS[kind];
  const stepX = size.w + GAP_X;
  const stepY = size.h + CAPTION_H + GAP_Y;
  const height = o.height || 1080;
  let total = o.total || 0;
  let idx = 0;

  const el = h('div', 'grid');
  el.style.top = (o.top || 0) + 'px';
  el.style.height = height + 'px';
  const track = add(el, 'div', 'grid-track');
  const ring = add(track, 'div', 'ring on');
  ring.style.width = (size.w + 16) + 'px';
  ring.style.height = (size.h + 16) + 'px';

  const poolRows = Math.ceil(height / stepY) + 3;
  const slots = [];
  for (let r = 0; r < poolRows; r++) {
    const rowEl = add(track, 'div', 'grid-row');
    const tiles = [];
    for (let c = 0; c < cols; c++) {
      const tile = createTile(kind);
      setTransform(tile, 'translateX(' + c * stepX + 'px)');
      rowEl.appendChild(tile);
      tiles.push(tile);
    }
    rowEl.style.visibility = 'hidden';
    slots.push({ el: rowEl, tiles: tiles, row: -1 });
  }

  function render() {
    const w = gridWindow(idx, cols, total, poolRows);
    for (let r = w.firstRow; r < w.lastRow; r++) {
      const slot = slots[r % poolRows];
      if (slot.row === r) continue;
      slot.row = r;
      slot.el.style.visibility = '';
      setTransform(slot.el, 'translateY(' + r * stepY + 'px)');
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const tile = slot.tiles[c];
        if (i < total) {
          tile.style.visibility = '';
          fillTile(tile, o.getItem(i) || null, kind);
        } else {
          tile.style.visibility = 'hidden';
        }
      }
    }
    for (let k = 0; k < poolRows; k++) {
      const slot = slots[k];
      if (slot.row !== -1 && (slot.row < w.firstRow || slot.row >= w.lastRow)) {
        slot.row = -1;
        slot.el.style.visibility = 'hidden';
      }
    }
    if (o.onNeed) o.onNeed(w.firstRow * cols, w.lastRow * cols + cols * 4);
    setTransform(track, 'translateY(' + (-w.scrollRow * stepY) + 'px)');
    setTransform(ring, 'translate(' + ((idx % cols) * stepX - 8) + 'px,' + (w.focusRow * stepY - 8) + 'px)');
  }

  function invalidate() {
    for (let k = 0; k < poolRows; k++) {
      slots[k].row = -1;
      for (let c = 0; c < cols; c++) slots[k].tiles[c]._t.item = undefined;
    }
  }

  const api = {
    el: el,
    cols: cols,
    poolRows: poolRows,
    total: function () { return total; },
    index: function () { return idx; },
    current: function () { return total ? o.getItem(idx) : undefined; },
    setTotal: function (n) { total = n; if (idx >= total) idx = Math.max(0, total - 1); invalidate(); render(); },
    // Data for some rows arrived: re-fill whatever is on screen.
    refresh: function () { invalidate(); render(); },
    reset: function () { idx = 0; total = 0; invalidate(); render(); },
    focusIndex: function (i) {
      idx = Math.max(0, Math.min(total - 1, i));
      render();
      if (o.onFocus) o.onFocus(api.current(), idx);
    },
    move: function (dx, dy) {
      const next = gridMove(idx, dx, dy, cols, total);
      if (next < 0) return false;
      api.focusIndex(next);
      return true;
    },
    select: function () {
      const item = api.current();
      if (item && o.onSelect) o.onSelect(item, idx);
    },
  };
  render();
  return api;
}
