// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Screen stack. Screens below the top stay mounted but hidden (display:none),
// so going back is instant and keeps their focus/scroll state.
//
// screen = { el, name, onKey(action) -> bool, onShow?(), onHide?(), destroy?() }
import { setHandler } from './input.js';
import { exitApp } from './platform/tizen.js';

const stack = [];
let root = null;
let globalKey = null;
let rootBack = null;

// 'longenter' (OK held) only reaches screens that set `longEnter: true`; for every other
// screen, or when that one does not consume it, it is a plain 'enter'.
function dispatch(action) {
  const top = stack[stack.length - 1];
  if (action === 'longenter') {
    if (top && top.longEnter && top.onKey && top.onKey(action) === true) return;
    action = 'enter';
  }
  if (top && top.onKey && top.onKey(action) === true) return;
  if (globalKey && globalKey(action) === true) return;
  if (action === 'back') back();
}

export function init(container, onGlobalKey) {
  root = container;
  globalKey = onGlobalKey || null;
  setHandler(dispatch);
}

// Called when Back is pressed on the root screen. Return true if it consumed
// the press (e.g. moved focus to the top); otherwise the app exits.
export function setRootBack(fn) {
  rootBack = fn;
}

function hide(screen) {
  screen.el.classList.add('hidden');
  if (screen.onHide) screen.onHide();
}

function reveal(screen) {
  screen.el.classList.remove('hidden');
  if (screen.onShow) screen.onShow();
}

function destroy(screen) {
  if (screen.onHide) screen.onHide();
  if (screen.destroy) screen.destroy();
  if (screen.el.parentNode) screen.el.parentNode.removeChild(screen.el);
}

export function push(screen) {
  const t = stack[stack.length - 1];
  if (t) hide(t);
  stack.push(screen);
  root.appendChild(screen.el);
  reveal(screen);
  return screen;
}

export function replace(screen) {
  const t = stack.pop();
  if (t) destroy(t);
  return push(screen);
}

// Drop everything and start over from one screen (sign in/out, server switch).
export function reset(screen) {
  while (stack.length) destroy(stack.pop());
  return push(screen);
}

export function back() {
  if (stack.length <= 1) {
    if (rootBack && rootBack() === true) return;
    exitApp();
    return;
  }
  destroy(stack.pop());
  reveal(stack[stack.length - 1]);
}

export function top() {
  return stack[stack.length - 1];
}

export function depth() {
  return stack.length;
}
