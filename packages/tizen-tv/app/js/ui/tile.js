// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Tiles (poster / wide / episode / grid). A tile node is created once and
// re-filled as it is recycled; fillTile only touches the DOM for fields that
// changed. Items are Jellyfin BaseItemDto (possibly slim copies from the cache).
import { h, setText, show, setTransform, toggleClass } from '../util/dom.js';
import { load } from './images.js';
import * as client from '../api/client.js';
import { kindOf } from '../api/hubs.js';
import { episodeLabel, duration, progressFraction } from '../util/format.js';

export const KINDS = {
  wide: { w: 400, h: 225 },
  poster: { w: 220, h: 330 },
  episode: { w: 384, h: 216, caption: true },
  grid: { w: 216, h: 324, caption: true },
};

export const CAPTION_H = 70;

const KIND_LABEL = { movie: 'Movie', series: 'Series', anime: 'Anime' };

/**
 * Image URL for an item: type is 'Primary' | 'Thumb' | 'Backdrop' | 'Logo'.
 * Episodes/seasons borrow their series' art when they have none of their own.
 * Returns '' when the item advertises no such image.
 */
export function imageFor(item, type, width) {
  if (!item) return '';
  const tags = item.ImageTags || {};
  const sid = item.SeriesId;
  let id = '';
  let tag = '';
  if (type === 'Primary') {
    if (tags.Primary) { id = item.Id; tag = tags.Primary; }
    else if (sid && item.SeriesPrimaryImageTag) { id = sid; tag = item.SeriesPrimaryImageTag; }
    else if (sid && (item.Type === 'Season')) { id = sid; tag = 'p'; }
  } else if (type === 'Thumb') {
    if (tags.Thumb) { id = item.Id; tag = tags.Thumb; }
  } else if (type === 'Backdrop') {
    const own = item.BackdropImageTags;
    const par = item.ParentBackdropImageTags;
    if (own && own.length) { id = item.Id; tag = own[0]; }
    else if (par && par.length) { id = item.ParentBackdropItemId || sid; tag = par[0]; }
  } else if (type === 'Logo') {
    if (tags.Logo) { id = item.Id; tag = tags.Logo; }
    else if (item.ParentLogoImageTag) { id = item.ParentLogoItemId || sid; tag = item.ParentLogoImageTag; }
  }
  if (!id) return '';
  return client.imageUrl(id, type, { width: width, tag: tag });
}

function artFor(item, kind, w) {
  const episode = item.Type === 'Episode';
  if (kind === 'wide' || kind === 'episode') {
    if (episode || kind === 'episode') {
      return imageFor(item, 'Primary', w) || imageFor(item, 'Thumb', w) || imageFor(item, 'Backdrop', w);
    }
    return imageFor(item, 'Thumb', w) || imageFor(item, 'Backdrop', w) || imageFor(item, 'Primary', w);
  }
  return imageFor(item, 'Primary', w) || imageFor(item, 'Thumb', w) || imageFor(item, 'Backdrop', w);
}

function titleFor(item, kind) {
  if (item.Type === 'Episode' && kind !== 'episode') return item.SeriesName || item.Name || '';
  return item.Name || '';
}

function subFor(item, kind) {
  if (item.Type === 'Episode') {
    if (kind === 'episode') return duration(item.RunTimeTicks);
    return episodeLabel(item) + (item.Name ? '  ' + item.Name : '');
  }
  if (item.Type === 'Season') return item.ChildCount ? item.ChildCount + ' episodes' : '';
  return item.ProductionYear ? String(item.ProductionYear) : '';
}

/** opts: {kindBadge:true} adds a small Movie/Series/Anime label. Returns the tile element. */
function add(parent, tag, cls) {
  const e = h(tag, cls);
  parent.appendChild(e);
  return e;
}

export function createTile(kind, opts) {
  const size = KINDS[kind];
  const el = h('div', 'tile tile-' + kind);
  const frame = add(el, 'div', 'tile-frame');
  const img = add(frame, 'img', 'tile-img');
  img.alt = '';
  const ph = add(frame, 'div', 'tile-ph');
  const badge = add(frame, 'div', 'tile-badge');
  const kb = opts && opts.kindBadge ? add(frame, 'div', 'tile-kind') : null;
  const bar = add(frame, 'div', 'tile-bar');
  const fill = add(bar, 'i', '');
  let cap = null;
  let sub = null;
  if (size.caption) {
    cap = add(el, 'div', 'tile-cap');
    sub = add(el, 'div', 'tile-sub');
  }
  show(badge, false);
  show(bar, false);
  if (kb) show(kb, false);
  el._t = { kind: kind, size: size, img: img, ph: ph, badge: badge, kb: kb, bar: bar, fill: fill, cap: cap, sub: sub, item: null };
  return el;
}

/** Re-fill a recycled tile. Exits early when it already shows `item`. */
export function fillTile(tile, item, kind) {
  const t = tile._t;
  if (t.item === item) return;
  t.item = item;
  kind = kind || t.kind;
  if (!item) {
    load(t.img, '');
    setText(t.ph, '');
    show(t.bar, false);
    show(t.badge, false);
    if (t.kb) show(t.kb, false);
    if (t.cap) { setText(t.cap, ''); setText(t.sub, ''); }
    return;
  }
  load(t.img, artFor(item, kind, t.size.w));
  setText(t.ph, titleFor(item, kind));

  const p = progressFraction(item);
  show(t.bar, p > 0.01);
  if (p > 0.01) setTransform(t.fill, 'scaleX(' + p.toFixed(3) + ')');

  const ud = item.UserData || {};
  let badge = '';
  if (item.Type === 'Series' && ud.UnplayedItemCount > 0) badge = String(ud.UnplayedItemCount);
  else if (ud.Played) badge = '✓';
  show(t.badge, !!badge);
  setText(t.badge, badge);
  toggleClass(t.badge, 'done', badge === '✓');

  if (t.kb) {
    const label = KIND_LABEL[kindOf(item)] || '';
    show(t.kb, !!label);
    setText(t.kb, label);
  }

  if (t.cap) {
    let cap = titleFor(item, kind);
    if (kind === 'episode') cap = (item.IndexNumber != null ? 'E' + item.IndexNumber + ' · ' : '') + (item.Name || '');
    setText(t.cap, cap);
    setText(t.sub, subFor(item, kind));
  }
}

/** The tile's own <img> (for focus-time tweaks). */
export function tileImage(tile) {
  return tile._t.img;
}

export function resetTile(tile) {
  const t = tile._t;
  t.item = undefined;
}
