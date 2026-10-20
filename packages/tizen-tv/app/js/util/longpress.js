// Hold-to-act for the remote's OK key. down() starts a timer; up() before it fires
// reports a normal press, otherwise `fire` already got the long action and up() is swallowed.
// Auto-repeat keydowns while held are ignored (e.repeat, or a second down within STALE_MS
// with no keyup between, for remotes that do not set the flag).
export const LONG_MS = 600;
const STALE_MS = 2000;

/**
 * @param {(action:string)=>void} fire  receives 'enter' (short) or 'longenter' (long)
 * @param {{ms?:number, now?:()=>number}} [o]
 */
export function createLongPress(fire, o) {
  o = o || {};
  const ms = o.ms || LONG_MS;
  const now = o.now || Date.now;
  let down = false;
  let timer = 0;
  let lastDown = 0;

  function clear() {
    if (timer) { clearTimeout(timer); timer = 0; }
  }

  return {
    /** Keydown. Returns false when it was an ignored repeat. */
    down: function (repeat) {
      const t = now();
      if (down && (repeat || t - lastDown < STALE_MS)) { lastDown = t; return false; }
      clear();
      down = true;
      lastDown = t;
      timer = setTimeout(function () { timer = 0; fire('longenter'); }, ms);
      return true;
    },
    /** Keyup. Returns true when a press was in progress. */
    up: function () {
      if (!down) return false;
      down = false;
      if (timer) { clear(); fire('enter'); }
      return true;
    },
    /** Drop a press in progress without firing (focus lost). */
    cancel: function () {
      down = false;
      clear();
    },
    pressed: function () { return down; },
  };
}
