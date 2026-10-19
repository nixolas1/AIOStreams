// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Thin wrapper over the Tizen / Samsung web APIs. Every call is guarded so the
// UI also runs in a desktop browser.

export function isTizen() {
  return typeof window.tizen !== 'undefined';
}

// keyCode -> action. Desktop keys mirror the remote for development.
export const KEYMAP = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  10009: 'back', 8: 'back', 27: 'back',
  10252: 'playpause', 32: 'playpause', 415: 'play', 19: 'pause', 413: 'stop',
  417: 'ff', 412: 'rw', 427: 'pageup', 428: 'pagedown', 33: 'pageup', 34: 'pagedown',
  403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info', 10073: 'info',
  65376: 'imedone', 65385: 'imecancel',
};

export function actionFor(e) {
  return KEYMAP[e.keyCode] || null;
}

export function registerKeys() {
  if (!isTizen()) return;
  const keys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward',
    'MediaRewind', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow',
    'ColorF3Blue', 'Info'];
  for (let i = 0; i < keys.length; i++) {
    try { window.tizen.tvinputdevice.registerKey(keys[i]); } catch (e) { /* unsupported key */ }
  }
}

export function exitApp() {
  try { window.tizen.application.getCurrentApplication().exit(); } catch (e) { try { window.close(); } catch (e2) { /* desktop */ } }
}

// Keeps the screen saver from starting (on = allow it, off = playback).
export function setScreenSaver(on) {
  try {
    const w = window.webapis;
    w.appcommon.setScreenSaver(on ? w.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_ON
      : w.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
  } catch (e) { /* not available */ }
}

export function isUhdPanel() {
  try { return !!window.webapis.productinfo.isUdPanelSupported(); } catch (e) { return false; }
}
