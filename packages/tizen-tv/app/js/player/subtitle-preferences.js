import * as store from '../util/store.js';
import * as session from '../session.js';
import { langCode, sameLang } from './tracks.js';

function key(item) {
  return item.Type === 'Episode' && item.SeriesId
    ? 'player.seriesSubs.' + JSON.stringify([session.getBase(), session.userId(), item.SeriesId]) : null;
}

export function subtitlePreference(opt) {
  return opt ? { off: false, lang: langCode(opt.lang), kind: opt.kind, label: opt.label || '' } : { off: true };
}

export function savedSubtitles(item, anime) {
  const k = key(item);
  const saved = k && store.get(k, null);
  if (saved && typeof saved.off === 'boolean') return saved;
  if (anime) return { off: false, lang: 'en' };
  const lang = store.get('player.subLang', store.get('subLang', 'off'));
  return { off: !lang || lang === 'off', lang: langCode(lang) };
}

export function saveSubtitles(item, opt) {
  const pref = subtitlePreference(opt);
  const k = key(item);
  if (k) store.set(k, pref);
  // Keep the existing default for new series; an unlabelled track is not "Off".
  if (pref.off || pref.lang) store.set('player.subLang', pref.off ? 'off' : pref.lang);
}

/** Episode track IDs are unstable: match language, then the same variant/source kind. */
export function preferredSubtitle(list, pref) {
  if (!pref || pref.off) return null;
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < list.length; i++) {
    const opt = list[i];
    if (pref.lang ? !sameLang(opt.lang, pref.lang) : !!langCode(opt.lang)) continue;
    // For unknown languages only restore an identically labelled track of the same kind.
    if (!pref.lang && (opt.label !== pref.label || opt.kind !== pref.kind)) continue;
    const score = (opt.label === pref.label ? 2 : 0) + (opt.kind === pref.kind ? 1 : 0);
    if (score > bestScore) { best = opt; bestScore = score; }
  }
  return best;
}
