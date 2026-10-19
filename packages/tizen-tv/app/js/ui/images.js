// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Image loading tuned for a slow TV CPU:
//  - a few downloads at a time, newest request first (what is on screen now
//    matters more than what scrolled past),
//  - jobs for nodes that were recycled before loading are dropped (img._want),
//  - decode() runs off the main thread before the image is attached, so
//    attaching never stalls a frame.
// API: load(img, url, {now}), prefetch(url), cancel(img).
const MAX_ACTIVE = 6;
const LOADED_MAX = 800;
const QUEUE_MAX = 200;

const queue = [];
let active = 0;
const loaded = new Map(); // url -> true, insertion order = LRU order

function remember(url) {
  loaded.delete(url);
  loaded.set(url, true);
  if (loaded.size > LOADED_MAX) loaded.delete(loaded.keys().next().value);
}

function attach(img, url, instant) {
  img.src = url;
  if (instant) {
    img.classList.add('in', 'now');
  } else {
    img.classList.remove('now');
    img.classList.add('in');
  }
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.pop(); // LIFO
    if (job.img._want !== job.url) continue; // recycled or cancelled meanwhile
    active++;
    const loader = new Image();
    loader.src = job.url;
    const done = function (ok) {
      active--;
      if (ok) {
        remember(job.url);
        if (job.img._want === job.url) attach(job.img, job.url, false);
      }
      pump();
    };
    if (loader.decode) loader.decode().then(function () { done(true); }, function () { done(false); });
    else { loader.onload = function () { done(true); }; loader.onerror = function () { done(false); }; }
  }
}

/** Point an <img> at a URL ('' clears it). opts.now attaches without waiting (no fade, no decode). */
export function load(img, url, opts) {
  if (img._want === url) return;
  img._want = url;
  if (!url) {
    img.classList.remove('in');
    img.removeAttribute('src');
    return;
  }
  if (loaded.has(url) || (opts && opts.now)) {
    attach(img, url, true);
    return;
  }
  img.classList.remove('in');
  queue.push({ img: img, url: url });
  if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
  pump();
}

/** Forget a pending load for img (what it shows now stays). */
export function cancel(img) {
  if (img._want) img._want = '';
}

/** Warm the cache without a target element (the next page of a grid, a hero). */
export function prefetch(url) {
  if (!url || loaded.has(url)) return;
  const sink = { _want: url, classList: { add: function () {}, remove: function () {} }, removeAttribute: function () {} };
  Object.defineProperty(sink, 'src', { set: function () {} });
  queue.push({ img: sink, url: url });
  pump();
}

export function _stats() {
  return { active: active, queued: queue.length, loaded: loaded.size };
}
