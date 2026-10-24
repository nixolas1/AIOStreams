// The HTTP-hosted bridge supplies the web referrer required by YouTube embeds.
import { h, setText, show } from '../util/dom.js';
import * as router from '../router.js';
import { getBase } from '../session.js';
import { setScreenSaver } from '../platform/tizen.js';

export function TrailerScreen(args) {
  const el = h('div', 'screen trailer');
  el.style.background = '#000';
  const status = h('div', { style: { position: 'absolute', top: '20px', left: '48px', fontSize: '26px' } }, 'Loading trailer…');
  const hint = h('div', { style: { position: 'absolute', bottom: '20px', left: '48px', fontSize: '24px' } }, 'OK: Play / pause    ← →: Seek    Back: Close');
  const frame = h('iframe', { title: args.title + ' trailer', tabindex: '-1', allow: 'autoplay; encrypted-media; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin', style: { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', border: '0', pointerEvents: 'none' } });
  const origin = new URL(getBase(), location.href).origin;
  frame.src = origin + '/static/tv-trailer.html#' + encodeURIComponent(args.id);
  el.appendChild(frame);
  el.appendChild(status);
  el.appendChild(hint);
  let timer = setTimeout(function () { setText(status, 'Trailer did not load. Press Back to return.'); }, 20000);
  function receive(e) {
    if (e.source !== frame.contentWindow || e.origin !== origin || !e.data || e.data.type !== 'tv-trailer') return;
    clearTimeout(timer);
    if (e.data.state === 'playing') { setText(status, ''); show(hint, false); setScreenSaver(false); }
    else if (e.data.state === 'error') { setText(status, 'YouTube could not play this trailer (' + e.data.code + '). Press Back to return.'); setScreenSaver(true); }
    else { setText(status, args.title + ' · Trailer'); setScreenSaver(true); }
  }
  window.addEventListener('message', receive);
  return {
    name: 'trailer', el: el,
    onKey: function (action) {
      if (action === 'back') return false;
      if (action === 'stop') { router.back(); return true; }
      frame.contentWindow.postMessage({ type: 'tv-trailer-control', action: action }, origin);
      return true;
    },
    onHide: function () { frame.src = 'about:blank'; setScreenSaver(true); },
    destroy: function () { clearTimeout(timer); window.removeEventListener('message', receive); frame.src = 'about:blank'; setScreenSaver(true); },
  };
}
