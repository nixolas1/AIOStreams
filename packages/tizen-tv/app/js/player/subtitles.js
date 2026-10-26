// Text subtitles (SRT / WebVTT) for drawing in the DOM over a direct-played video.
// Cue lookup (CueTrack) adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0;
// the parser is rewritten line-based so odd real-world files do not stall it.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

// Reverse only complete UTF-8 sequences mistakenly decoded as Latin-1/Windows-1252.
// Work per sequence so valid Norwegian/Japanese text elsewhere is never re-decoded.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function legacyByte(c) {
  const n = c.charCodeAt(0);
  if (n <= 255) return n;
  const i = CP1252.indexOf(c);
  return i < 0 ? -1 : 128 + i;
}

export function repairSubtitleText(text) {
  const source = String(text);
  let out = '';
  for (let at = 0; at < source.length; at++) {
    const first = legacyByte(source.charAt(at));
    const size = first >= 194 && first <= 244 ? (first < 224 ? 2 : first < 240 ? 3 : 4) : 0;
    let encoded = '';
    for (let i = 0; size && i < size && at + i < source.length; i++) {
      const b = legacyByte(source.charAt(at + i));
      if (b < 0 || (i && (b < 128 || b > 191))) break;
      encoded += '%' + b.toString(16);
    }
    if (size && encoded.length === size * 3) {
      try {
        out += decodeURIComponent(encoded);
        at += size - 1;
        continue;
      } catch (e) { /* not a valid UTF-8 sequence; preserve the original */ }
    }
    out += source.charAt(at);
  }
  return out;
}

/** Preserve BOM/declared encodings; prefer valid UTF-8 over misleading legacy headers. */
export function readSubtitleResponse(response) {
  return response.arrayBuffer().then(function (buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* legacy file */ }
    const header = response.headers.get('content-type') || '';
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(header);
    try { return new TextDecoder(charset ? charset[1] : 'windows-1252').decode(bytes); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  });
}

/** Removes markup (<i>, <font>, <c.cls>, {\an8}) and decodes the common entities. */
export function stripTags(s) {
  return repairSubtitleText(String(s == null ? '' : s))
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, e) {
      if (e.charAt(0) === '#') {
        const n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 ? String.fromCharCode(n) : '';
      }
      const v = NAMED[e.toLowerCase()];
      return v == null ? m : v;
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// "00:01:02,345", "01:02.345", "1:02:03.4" -> ms, or -1.
function stamp(s) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return -1;
  const frac = m[4] ? Math.round(parseFloat('0.' + m[4]) * 1000) : 0;
  return ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 + frac;
}

/** Parses SRT or WebVTT text into [{start, end, text}] (ms), sorted by start. */
export function parseCues(input) {
  const src = String(input == null ? '' : input).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = src.split(/\n{2,}/);
  const cues = [];
  for (let b = 0; b < blocks.length; b++) {
    const lines = blocks[b].split('\n');
    let at = -1;
    for (let i = 0; i < lines.length && i < 3; i++) {
      if (lines[i].indexOf('-->') >= 0) { at = i; break; }
    }
    if (at < 0) continue;
    const parts = lines[at].split('-->');
    const start = stamp(parts[0]);
    // The end may be followed by VTT cue settings ("align:start line:90%").
    const end = stamp(parts[1].trim().split(/\s+/)[0]);
    if (start < 0 || end < 0) continue;
    const body = stripTags(lines.slice(at + 1).join('\n'));
    if (body) cues.push({ start: start, end: end, text: body });
  }
  cues.sort(function (a, b) { return a.start - b.start; });
  return cues;
}

/** Finds the cue text for a playback time: cheap while time advances, binary search after jumps. */
export class CueTrack {
  constructor(cues) {
    this.cues = cues || [];
    this.i = 0;
  }

  // Index of the last cue with start <= t (or -1).
  _locate(t) {
    const cues = this.cues;
    const n = cues.length;
    let i = this.i;
    if (i < n && cues[i].start <= t) {
      // Walk forward a few steps (normal playback), else binary search.
      let steps = 0;
      while (i + 1 < n && cues[i + 1].start <= t && steps < 8) { i++; steps++; }
      if (i + 1 >= n || cues[i + 1].start > t) return i;
    }
    let lo = 0;
    let hi = n - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  /** Text to show at t ms ('' when none). Overlapping cues are joined. */
  textAt(t) {
    if (!this.cues.length) return '';
    const i = this._locate(t);
    this.i = i < 0 ? 0 : i;
    if (i < 0) return '';
    const cues = this.cues;
    let out = '';
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      if (cues[j].end > t && cues[j].start <= t && out.indexOf(cues[j].text) < 0) out += (out ? '\n' : '') + cues[j].text;
    }
    return out;
  }

  /** Alias of textAt (tests and callers outside the Chrome 76 lint). */
  at(t) {
    return this.textAt(t);
  }
}

export const SUBTITLE_SIZES = [32, 38, 46, 56, 68];
export const SUBTITLE_SIZE_LABELS = ['Small', 'Medium', 'Default', 'Large', 'Extra large'];
export function subtitleSize(value) {
  return SUBTITLE_SIZES.indexOf(value) >= 0 ? value : 46;
}

/** Nearest dialogue, including between cues and before the first cue. */
export function nearestCue(cues, time) {
  let best = null;
  let distance = Infinity;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const d = time < cue.start ? cue.start - time : Math.max(0, time - cue.end);
    if (d < distance) { best = cue; distance = d; }
    if (d === 0) break;
  }
  return best ? best.text.replace(/\s+/g, ' ') : '';
}
