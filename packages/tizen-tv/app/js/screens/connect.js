// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0 (login flow and focus-zone layout)
// Connect: step 1 server address, step 2 Quick Connect code (+ QR of the public web address).
// The Quick Connect secret stays in this closure; it is never rendered or put in the QR.
import { h, setText, show, toggleClass } from '../util/dom.js';
import * as session from '../session.js';
import * as jellyfin from '../api/jellyfin.js';
import * as router from '../router.js';
import { createField } from '../ui/keyboard.js';
import { HomeScreen } from './home.js';
import qrcode from '../vendor/qrcode.js';

const VALIDATE_TIMEOUT_MS = 6000;
const POLL_MS = 3000;
const CODE_LIFETIME_MS = 5 * 60 * 1000;

/** "host:port" | "http://host:port[/jellyfin]" -> normalized base, or ''. */
export function parseServerInput(input) {
  return session.normalizeServerUrl(input);
}

/** The server's web UI address (where the user approves the code): the origin of the API base. */
export function webAddress(base) {
  try { return new URL(base).origin + '/'; } catch (e) { return ''; }
}

/** Hostname[:port] only, for display. */
export function hostOf(base) {
  try { return new URL(base).host; } catch (e) { return ''; }
}

/**
 * GET {base}/System/Info/Public with a timeout.
 * @returns {Promise<{ok:true,name:string}|{ok:false,error:string}>}
 */
export async function validateServer(base, fetchImpl, timeoutMs) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!base) return { ok: false, error: 'Enter an address like 192.168.1.20:3000' };
  if (!doFetch) return { ok: false, error: 'No network available' };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || VALIDATE_TIMEOUT_MS);
  let timedOut = false;
  const guard = new Promise(function (resolve) {
    setTimeout(function () { timedOut = true; resolve(null); }, (timeoutMs || VALIDATE_TIMEOUT_MS) + 200);
  });
  try {
    const res = await Promise.race([
      doFetch(base + '/System/Info/Public', { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined }),
      guard,
    ]);
    if (timedOut || !res) return { ok: false, error: 'No answer from the server. Check the address and that the TV is on the same network.' };
    if (!res.ok) return { ok: false, error: 'That address answered with an error (' + res.status + '). Is it an AIOStreams /jellyfin address?' };
    let info = null;
    try { info = await res.json(); } catch (e) { info = null; }
    if (!info || typeof info !== 'object' || (!info.ServerName && !info.ProductName && !info.Id)) {
      return { ok: false, error: 'That does not look like an AIOStreams server.' };
    }
    return { ok: true, name: String(info.ServerName || info.ProductName || 'AIOStreams') };
  } catch (e) {
    return { ok: false, error: 'Could not reach the server. Check the address and that the TV is on the same network.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Draw a QR for `text` into a canvas (dark modules on cream). */
export function drawQr(canvas, text, size) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const cell = Math.floor(size / (n + quiet * 2));
  const px = cell * (n + quiet * 2);
  canvas.width = px; canvas.height = px;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFF7E6';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#0B0D12';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }
  return n;
}

function brand() {
  return h('div', 'topbar', [
    h('div', 'brand', [h('div', 'brand-mark'), h('div', 'brand-word', 'AIOStreams')]),
  ]);
}

export function ConnectScreen() {
  let step = 'server'; // 'server' | 'code'
  let zone = 'field';  // server step: 'field' | 'btn'
  let busy = false;
  let serverName = '';
  let alive = true;
  let visible = false;
  let runId = 0; // bumps to cancel a running Quick Connect session
  let codeExpiresAt = 0;

  const field = createField({
    placeholder: '192.168.1.20:3000',
    value: session.getBase() || '',
    label: 'Server address',
    onDone: function () { zone = 'btn'; paint(); submit(); },
  });
  const status = h('div', 'conn-status');
  const btn = h('div', 'btn conn-btn', 'Connect');

  const serverPane = h('div', 'conn-pane conn-server', [
    h('div', 'conn-title', 'Connect to your server'),
    h('div', 'conn-sub', 'Enter the address of your AIOStreams server. A port is usually needed, for example 192.168.1.20:3000.'),
    field.el,
    status,
    btn,
  ]);

  // code step
  const codeEl = h('div', 'conn-code', '------');
  const codeNote = h('div', 'conn-note');
  const qrCanvas = h('canvas', 'conn-qr');
  const qrCaption = h('div', 'conn-qr-cap', 'Scan to open AIOStreams');
  const qrBox = h('div', 'conn-qrbox', [qrCanvas, qrCaption]);
  const serverLine = h('div', 'conn-server-line');
  const codePane = h('div', 'conn-pane conn-codepane', [
    h('div', 'conn-title', 'Sign in with Quick Connect'),
    serverLine,
    codeEl,
    h('ol', 'conn-steps', [
      h('li', null, 'Open AIOStreams on your phone or computer'),
      h('li', null, 'Go to Save & Install, then Sign-in addresses'),
      h('li', null, 'Approve this code'),
    ]),
    codeNote,
    qrBox,
  ]);

  const el = h('div', { class: 'screen screen-connect', dataset: { screen: 'connect' } }, [brand(), serverPane, codePane]);

  function setStatus(text, kind) {
    setText(status, text || '');
    toggleClass(status, 'err', kind === 'err');
    toggleClass(status, 'ok', kind === 'ok');
  }

  function paint() {
    show(serverPane, step === 'server');
    show(codePane, step === 'code');
    field.setFocused(step === 'server' && zone === 'field');
    toggleClass(btn, 'focus', step === 'server' && zone === 'btn');
    setText(btn, busy ? 'Checking...' : 'Connect');
  }

  async function submit() {
    if (busy) return;
    const base = parseServerInput(field.value());
    if (!base) { setStatus('Enter an address like 192.168.1.20:3000', 'err'); return; }
    busy = true;
    setStatus('Checking ' + hostOf(base) + '...');
    paint();
    const r = await validateServer(base);
    busy = false;
    if (!alive) return;
    if (!r.ok) { setStatus(r.error, 'err'); paint(); return; }
    session.setBase(base);
    serverName = r.name;
    setStatus(r.name + ' found', 'ok');
    startCode();
  }

  function startCode() {
    step = 'code';
    setText(serverLine, serverName + '  ·  ' + hostOf(session.getBase()));
    try { drawQr(qrCanvas, webAddress(session.getBase()), 280); show(qrBox, true); } catch (e) { show(qrBox, false); }
    paint();
    runQuickConnect();
  }

  function stopCode() { runId++; }

  async function runQuickConnect() {
    const my = ++runId;
    const cur = function () { return alive && my === runId; };
    setText(codeEl, '------');
    setText(codeNote, 'Requesting a code...');
    let init;
    try {
      init = await jellyfin.quickConnectInitiate();
    } catch (e) {
      if (!cur()) return;
      const unsupported = e && (e.status === 401 || e.status === 403 || e.status === 404);
      setText(codeNote, unsupported ? 'Quick Connect is not available on this server.' : 'Could not reach the server. Retrying...');
      if (!unsupported) setTimeout(function () { if (cur()) runQuickConnect(); }, 4000);
      return;
    }
    if (!cur()) return;
    const secret = init && init.Secret;
    setText(codeEl, init && init.Code ? String(init.Code) : '------');
    codeExpiresAt = Date.now() + CODE_LIFETIME_MS;
    setText(codeNote, 'Waiting for approval...');
    while (cur()) {
      await new Promise(function (r) { setTimeout(r, POLL_MS); });
      if (!cur()) return;
      if (Date.now() > codeExpiresAt) { runQuickConnect(); return; }
      let st = null;
      try {
        st = await jellyfin.quickConnectState(secret);
      } catch (e) {
        if (e && (e.status === 404 || e.status === 401)) { runQuickConnect(); return; }
        continue; // transient
      }
      if (!cur()) return;
      if (st && st.Authenticated) {
        setText(codeNote, 'Approved. Signing in...');
        try {
          const r = await jellyfin.authenticateQuickConnect(secret);
          if (!cur()) return;
          session.signIn({ token: r.AccessToken, userId: r.User && r.User.Id, userName: r.User && r.User.Name });
          router.reset(HomeScreen({}));
        } catch (e) {
          if (!cur()) return;
          setText(codeNote, 'Sign in failed. Getting a new code...');
          setTimeout(function () { if (cur()) runQuickConnect(); }, 1500);
        }
        return;
      }
    }
  }

  paint();

  return {
    name: 'connect',
    el: el,
    onShow: function () {
      visible = true;
      if (step === 'code') runQuickConnect();
    },
    onHide: function () { visible = false; stopCode(); },
    destroy: function () { alive = false; stopCode(); },
    onKey: function (action) {
      if (step === 'code') {
        if (action === 'back') { stopCode(); step = 'server'; zone = 'field'; paint(); return true; }
        if (action === 'enter') { runQuickConnect(); return true; }
        return false;
      }
      if (field.handleKey(action)) return true;
      if (action === 'down' && zone === 'field') { zone = 'btn'; paint(); return true; }
      if (action === 'up' && zone === 'btn') { zone = 'field'; paint(); return true; }
      if (action === 'enter' && zone === 'btn') { submit(); return true; }
      return action === 'left' || action === 'right' || action === 'up' || action === 'down';
    },
  };
}
