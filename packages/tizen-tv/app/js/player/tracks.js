// Audio / subtitle track helpers and the picker panel (press Down in the player).
// Panel layout adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0.
// DTS avoidance mirrors packages/web/src/lib/hosts/tizen/player.ts (startAudio).
import { h, setTransform, toggleClass } from '../util/dom.js';

const UNDECODABLE = /dts|truehd|mlp/i;

export function isUndecodable(codec) {
  return UNDECODABLE.test(String(codec || ''));
}

const LANG = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ja: 'Japanese',
  ko: 'Korean', zh: 'Chinese', ru: 'Russian', no: 'Norwegian', sv: 'Swedish', da: 'Danish', fi: 'Finnish',
  nl: 'Dutch', pl: 'Polish', tr: 'Turkish', ar: 'Arabic', hi: 'Hindi', cs: 'Czech', el: 'Greek', he: 'Hebrew',
  hu: 'Hungarian', th: 'Thai', uk: 'Ukrainian', id: 'Indonesian', vi: 'Vietnamese', ro: 'Romanian',
};
const ALIAS = {
  eng: 'en', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko',
  chi: 'zh', zho: 'zh', rus: 'ru', nor: 'no', nob: 'no', nno: 'no', swe: 'sv', dan: 'da', fin: 'fi', dut: 'nl',
  nld: 'nl', pol: 'pl', tur: 'tr', ara: 'ar', hin: 'hi', cze: 'cs', ces: 'cs', gre: 'el', ell: 'el', heb: 'he',
  hun: 'hu', tha: 'th', ukr: 'uk', ind: 'id', vie: 'vi', rum: 'ro', ron: 'ro',
};

/** Two-letter code for a 2- or 3-letter language code ('' when unknown). */
export function langCode(lang) {
  const l = String(lang || '').toLowerCase().split(/[-_]/)[0];
  if (!l || l === 'und' || l === 'unk') return '';
  if (l.length === 2) return l;
  return ALIAS[l] || l;
}

export function sameLang(a, b) {
  const x = langCode(a);
  return !!x && x === langCode(b);
}

export function langName(lang) {
  const c = langCode(lang);
  return c ? (LANG[c] || c.toUpperCase()) : '';
}

const CODEC = { EAC3: 'DD+', AC3: 'DD', DTS: 'DTS', DTSH: 'DTS-HD', TRUEHD: 'TrueHD', AAC: 'AAC', MP3: 'MP3', OPUS: 'Opus', FLAC: 'FLAC' };

/** "English · DD+" / "Track 2". */
export function audioLabel(track, n) {
  const lang = langName(track.lang);
  const codec = String(track.codec || '').trim().replace(/^audio\/(?:x-)?/i, '').replace(/[-_]/g, '');
  const c = codec ? (CODEC[codec.toUpperCase()] || codec.toUpperCase()) : '';
  const parts = [];
  parts.push(lang || 'Track ' + n);
  if (track.title) parts.push(track.title);
  if (track.channels) parts.push(track.channels + ' ch');
  if (c) parts.push(c);
  return parts.length ? parts.join('  ·  ') : 'Track ' + n;
}

/** "English" / "English  ·  SDH" / "Subtitle 2". */
export function subtitleLabel(stream, n) {
  const lang = langName(stream.lang || stream.Language);
  const title = String(stream.title || stream.Title || stream.DisplayTitle || '').trim();
  if (title) return lang && title.toLowerCase().indexOf(lang.toLowerCase()) < 0 ? lang + '  ·  ' + title : title;
  return lang || 'Subtitle ' + n;
}

/** Only describe supplied metadata; an unmarked track is not necessarily full dialogue. */
export function subtitleDescription(stream, kind) {
  const title = String(stream.title || stream.Title || stream.DisplayTitle || '');
  const parts = [kind === 'emb' ? 'In this video' : 'Downloaded subtitle'];
  if (stream.IsForced || stream.forced || /forced|signs|songs/i.test(title)) parts.push('Forced / signs & songs');
  if (stream.IsHearingImpaired || stream.hearingImpaired || /\b(sdh|cc)\b|hearing.impaired/i.test(title)) parts.push('SDH / sound captions');
  if (stream.IsDefault || stream.default) parts.push('Default');
  return parts.join('  ·  ');
}

/**
 * Which audio track to play: the user's language (or the file's own pick), in a format the TV
 * decodes where the file has one. Returns the id to select (may equal `currentId`), or null.
 */
export function chooseAudio(tracks, currentId, preferredLang) {
  if (!tracks.length) return null;
  let playing = null;
  for (let i = 0; i < tracks.length; i++) if (tracks[i].id === currentId) playing = tracks[i];
  let lang = preferredLang && tracks.some(function (t) { return sameLang(t.lang, preferredLang); }) ? preferredLang : (playing && playing.lang) || '';
  const wanted = lang ? tracks.filter(function (t) { return sameLang(t.lang, lang) || t.lang === lang; }) : tracks.slice();
  const pool = wanted.length ? wanted : tracks;
  const decoded = pool.filter(function (t) { return !isUndecodable(t.codec); });
  if (playing && decoded.indexOf(playing) >= 0) return playing.id;
  if (decoded.length) return decoded[0].id;
  // Nothing in that language decodes: any decodable track beats silence.
  const any = tracks.filter(function (t) { return !isUndecodable(t.codec); });
  if (any.length) return any[0].id;
  return (pool[0] || playing).id;
}

const ROW_H = 64;
const VISIBLE = 6;

/**
 * Three-column picker. open({audio:[{label,on}], subs:[{label,on}], sizes:[{label,on}]}); keys go through onKey(action).
 * handlers.onChoose(col, index) with col 0 = audio, 1 = subtitles, 2 = font size; handlers.onClose().
 */
export function createTracksPanel(handlers) {
  const el = h('div', 'tracks hidden');
  const cols = [];
  let lists = [[], [], []];
  let col = 0;
  let idx = [0, 0, 0];
  let isOpen = false;

  const names = ['Audio', 'Subtitles', 'Font size'];
  for (let c = 0; c < 3; c++) {
    const wrap = h('div', 'tracks-col');
    const head = h('div', 'tracks-head', names[c]);
    const clip = h('div', 'tracks-clip');
    const track = h('div', 'tracks-list');
    clip.appendChild(track);
    wrap.appendChild(head);
    wrap.appendChild(clip);
    el.appendChild(wrap);
    cols.push({ wrap: wrap, track: track, rows: [] });
  }
  const hint = h('div', 'tracks-hint', 'OK select & watch   ·   Down during playback reopens tracks   ·   Back close');
  el.appendChild(hint);

  function build() {
    for (let c = 0; c < 3; c++) {
      const t = cols[c].track;
      t.textContent = '';
      cols[c].rows = [];
      for (let i = 0; i < lists[c].length; i++) {
        const row = h('div', 'tracks-opt', [h('span', 'tracks-mark', lists[c][i].on ? '✓' : ''), h('div', 'tracks-copy', [h('div', 'tracks-label', lists[c][i].label), h('div', 'tracks-description', lists[c][i].description || '')])]);
        t.appendChild(row);
        cols[c].rows.push(row);
      }
      if (!lists[c].length) t.appendChild(h('div', 'tracks-empty', c === 0 ? 'Only one track' : 'None available'));
    }
  }

  function paint() {
    for (let c = 0; c < 3; c++) {
      const rows = cols[c].rows;
      for (let i = 0; i < rows.length; i++) toggleClass(rows[i], 'focus', c === col && i === idx[c]);
      toggleClass(cols[c].wrap, 'active', c === col);
      const first = Math.max(0, Math.min(idx[c] - 2, Math.max(0, rows.length - (c === 1 ? 4 : VISIBLE))));
      setTransform(cols[c].track, 'translateY(' + (-first * (c === 1 ? 96 : ROW_H)) + 'px)');
    }
  }

  return {
    el: el,
    isOpen: function () { return isOpen; },
    open: function (data) {
      lists = [data.audio || [], data.subs || [], data.sizes || []];
      build();
      idx = lists.map(function (list) { return Math.max(0, list.findIndex(function (x) { return x.on; })); });
      col = lists[0].length > 1 || !lists[1].length ? 0 : 1;
      el.classList.remove('hidden');
      isOpen = true;
      paint();
    },
    close: function () {
      if (!isOpen) return;
      isOpen = false;
      el.classList.add('hidden');
      if (handlers && handlers.onClose) handlers.onClose();
    },
    onKey: function (action) {
      if (!isOpen) return false;
      if (action === 'back') { this.close(); return true; }
      if (action === 'left') col = Math.max(0, col - 1);
      else if (action === 'right') col = Math.min(2, col + 1);
      else if (action === 'up') {
        if (idx[col] === 0) { this.close(); return true; }
        idx[col]--;
      } else if (action === 'down') idx[col] = Math.min(Math.max(0, lists[col].length - 1), idx[col] + 1);
      else if (action === 'enter') {
        if (lists[col][idx[col]] && handlers && handlers.onChoose) handlers.onChoose(col, idx[col]);
        return true;
      }
      paint();
      return true;
    },
  };
}
