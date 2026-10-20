// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Remote input. Navigation keys are applied at most once per animation frame
// (extra presses of the same key in one frame collapse), so holding a direction
// can never queue up work. While a key is held <html> gets .fast, which
// shortens transitions and lets screens defer expensive updates.
import { actionFor } from './platform/tizen.js';
import { createLongPress } from './util/longpress.js';

const NAV = { left: 1, right: 1, up: 1, down: 1 };
// Actions a focused <input> still hands to the screen (everything else types).
const FROM_INPUT = { back: 1, up: 1, down: 1, enter: 1, imedone: 1, imecancel: 1 };

let handler = null;
let pending = null;
let scheduled = false;
let fastTimer = 0;
let lastNavAt = 0;
const root = document.documentElement;

export const stats = { keyAt: 0 };

// OK outside a text field acts on release (or 'longenter' after a hold), never on press.
const okKey = createLongPress(function (action) {
  stats.keyAt = performance.now();
  if (handler) handler(action);
});

export function setHandler(fn) {
  handler = fn;
}

function setFast(on) {
  if (root.classList.contains('fast') !== on) root.classList.toggle('fast', on);
}

function flush() {
  if (!scheduled) return;
  scheduled = false;
  const action = pending;
  pending = null;
  if (action && handler) handler(action);
}

function queueNav(action) {
  pending = action;
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(flush);
    // rAF pauses when the page is occluded; never let input stall on it.
    setTimeout(flush, 50);
  }
}

document.addEventListener('keydown', function (e) {
  const action = actionFor(e);
  if (!action) return;
  const ae = document.activeElement;
  const typing = ae && ae.tagName === 'INPUT';
  if (typing && !FROM_INPUT[action]) return;
  e.preventDefault();
  stats.keyAt = performance.now();

  if (action === 'enter' && !typing) { okKey.down(e.repeat); return; }
  if (NAV[action]) {
    const now = performance.now();
    const held = e.repeat || now - lastNavAt < 140;
    lastNavAt = now;
    if (held) {
      setFast(true);
      clearTimeout(fastTimer);
      fastTimer = setTimeout(function () { setFast(false); }, 220);
    }
    queueNav(action);
    return;
  }
  if (handler) handler(action);
}, true);

document.addEventListener('keyup', function (e) {
  if (actionFor(e) === 'enter' && okKey.up()) e.preventDefault();
  clearTimeout(fastTimer);
  fastTimer = setTimeout(function () { setFast(false); }, 60);
});

window.addEventListener('blur', function () { okKey.cancel(); });

// Feed an action through the same path as a real key press.
export function inject(action) {
  stats.keyAt = performance.now();
  if (NAV[action]) queueNav(action);
  else if (handler) handler(action);
}

export function isFast() {
  return root.classList.contains('fast');
}
