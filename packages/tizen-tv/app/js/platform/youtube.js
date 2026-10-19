// YouTube trailer launch for Samsung TVs.
//
// youtubeId(url) -> id | ''
// openYouTube(id) -> Promise<'dial'|'appcontrol'>
// Samsung's YouTube app ignores a plain view URI, so the primary path is the TV's own DIAL
// server (POST v=<id>); the fallback hands the same params to the app as a PAYLOAD.

const YOUTUBE_APP_ID = '111299001912';
const DIAL_URL = 'http://127.0.0.1:8080/ws/app/YouTube';
const DIAL_TIMEOUT_MS = 4000;
const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

export function youtubeId(url) {
  if (typeof url !== 'string') return '';
  const m = url.match(/^(?:https?:)?\/\/([^\/?#]+)([^?#]*)(?:\?([^#]*))?/i);
  if (!m) return '';
  const host = m[1].toLowerCase().replace(/^(www|m|music)\./, '');
  const path = m[2];
  let id = '';
  if (host === 'youtu.be') {
    id = path.split('/')[1] || '';
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const p = path.match(/^\/(?:embed|v|shorts|live)\/([^\/]+)/);
    if (p) {
      id = p[1];
    } else if (path === '/watch' && m[3]) {
      const q = m[3].split('&');
      for (let i = 0; i < q.length; i++) {
        if (q[i].indexOf('v=') === 0) { id = q[i].slice(2); break; }
      }
    }
  }
  return ID_RE.test(id) ? id : '';
}

function viaDial(id) {
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (!settled) { settled = true; reject(new Error('dial timeout')); }
    }, DIAL_TIMEOUT_MS);
    try {
      fetch(DIAL_URL, { method: 'POST', mode: 'no-cors', body: 'v=' + id }).then(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve('dial');
      }, function (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
    } catch (e) {
      settled = true;
      clearTimeout(timer);
      reject(e);
    }
  });
}

function viaAppControl(id) {
  return new Promise(function (resolve, reject) {
    try {
      const t = window.tizen;
      const payload = '{"values":"v=' + id + '"}';
      const ctl = new t.ApplicationControl(
        'http://tizen.org/appcontrol/operation/view', null, null, null,
        [new t.ApplicationControlData('PAYLOAD', [payload])]
      );
      t.application.launchAppControl(ctl, YOUTUBE_APP_ID, function () { resolve('appcontrol'); }, function (e) { reject(e); });
    } catch (e) {
      reject(e);
    }
  });
}

export function openYouTube(id) {
  return viaDial(id).catch(function () { return viaAppControl(id); });
}
