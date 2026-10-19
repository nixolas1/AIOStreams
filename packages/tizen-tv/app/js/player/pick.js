// Chooses which MediaSource to play on a Samsung (Tizen 6) TV.
// Direct-play whitelist adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0;
// the DTS rule mirrors packages/web/src/lib/hosts/tizen/player.ts ("Samsung's TVs since 2018
// can't decode it").
//
// AIOStreams sources often carry only a text Name (and the parsed `aiostreams` extension), not
// MediaStreams, so every fact is read from the best evidence present: MediaStreams, then the
// aiostreams extension, then the free text of the name.

const CONTAINERS = { mp4: 1, m4v: 1, mov: 1, mkv: 1, webm: 1, ts: 1, mpegts: 1, avi: 1 };
const VIDEO = { h264: 1, hevc: 1, vp9: 1, av1: 1, mpeg4: 1, mpeg2video: 1, vc1: 1 };
const AUDIO = { aac: 1, ac3: 1, eac3: 1, mp3: 1, mp2: 1, flac: 1, opus: 1, vorbis: 1, pcm: 1 };
// Audio the TV cannot decode (no passthrough on a direct-played stream).
const UNDECODABLE = { dts: 'DTS', truehd: 'TrueHD' };

// Jellyfin/ffprobe container names -> our whitelist keys.
const CONTAINER_ALIAS = { matroska: 'mkv', mpeg: 'mpegts', quicktime: 'mov', mp42: 'mp4', isom: 'mp4' };

const VIDEO_ALIAS = {
  avc: 'h264', h264: 'h264', x264: 'h264', 'h.264': 'h264',
  hevc: 'hevc', h265: 'hevc', x265: 'hevc', 'h.265': 'hevc',
  av1: 'av1', vp9: 'vp9', vc1: 'vc1', 'vc-1': 'vc1',
  mpeg4: 'mpeg4', xvid: 'mpeg4', divx: 'mpeg4', mpeg2video: 'mpeg2video', mpeg2: 'mpeg2video',
};

const AUDIO_ALIAS = {
  aac: 'aac', ac3: 'ac3', 'ac-3': 'ac3', dd: 'ac3', eac3: 'eac3', 'e-ac-3': 'eac3', ddp: 'eac3', 'dd+': 'eac3',
  mp3: 'mp3', mp2: 'mp2', flac: 'flac', opus: 'opus', vorbis: 'vorbis',
  pcm: 'pcm', lpcm: 'pcm', pcm_s16le: 'pcm', pcm_s24le: 'pcm',
  dts: 'dts', dca: 'dts', 'dts-hd': 'dts', dtshd: 'dts', truehd: 'truehd', mlp: 'truehd',
};

function text(source) {
  const a = source.aiostreams || {};
  const parts = [source.Name, a.filename, a.encode, a.quality, a.resolution];
  if (a.visualTags) parts.push(a.visualTags.join(' '));
  if (a.audioTags) parts.push(a.audioTags.join(' '));
  return parts.filter(Boolean).join('\n');
}

function streamsOf(source, type) {
  const all = source.MediaStreams || [];
  const out = [];
  for (let i = 0; i < all.length; i++) if (all[i].Type === type) out.push(all[i]);
  return out;
}

function containerOf(source) {
  const raw = String(source.Container || '').toLowerCase();
  if (raw) {
    const toks = raw.split(',');
    for (let i = 0; i < toks.length; i++) {
      const t = CONTAINER_ALIAS[toks[i]] || toks[i];
      if (CONTAINERS[t]) return t;
    }
    return toks[0];
  }
  const name = (source.aiostreams && source.aiostreams.filename) || source.Path || '';
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(String(name));
  return m ? (CONTAINER_ALIAS[m[1].toLowerCase()] || m[1].toLowerCase()) : '';
}

function videoCodecs(source, t) {
  const out = [];
  const streams = streamsOf(source, 'Video');
  for (let i = 0; i < streams.length; i++) {
    const c = String(streams[i].Codec || '').toLowerCase();
    out.push(VIDEO_ALIAS[c] || c);
  }
  if (out.length) return out;
  if (/\b(?:hevc|x\.?265|h\.?265)\b/i.test(t)) out.push('hevc');
  else if (/\bav1\b/i.test(t)) out.push('av1');
  else if (/\b(?:x\.?264|h\.?264|avc)\b/i.test(t)) out.push('h264');
  else if (/\bvp9\b/i.test(t)) out.push('vp9');
  else if (/\b(?:xvid|divx)\b/i.test(t)) out.push('mpeg4');
  return out;
}

function audioCodecs(source, t) {
  const out = [];
  const streams = streamsOf(source, 'Audio');
  for (let i = 0; i < streams.length; i++) {
    const c = String(streams[i].Codec || '').toLowerCase();
    out.push(AUDIO_ALIAS[c] || c);
  }
  if (out.length) return out;
  // Free text. DTS and TrueHD first so "DTS-HD MA" is not read as anything else.
  if (/\bDTS(?:[-: ]?(?:HD|X|ES|MA))?(?![a-z])/i.test(t)) out.push('dts');
  if (/true\s?-?hd/i.test(t)) out.push('truehd');
  if (/\b(?:DDP|DD\+|E-?AC-?3)(?![a-z])/i.test(t)) out.push('eac3');
  if (/\b(?:DD|AC-?3)(?![a-z+])/i.test(t)) out.push('ac3');
  if (/\bAAC(?![a-z])/i.test(t)) out.push('aac');
  if (/\bFLAC(?![a-z])/i.test(t)) out.push('flac');
  if (/\bOPUS(?![a-z])/i.test(t)) out.push('opus');
  if (/\bMP3(?![a-z])/i.test(t)) out.push('mp3');
  return out;
}

/** What is known about a source. Unknown parts are '' / [] and never cause a rejection. */
export function describeSource(source) {
  const t = text(source);
  const a = source.aiostreams || {};
  const vis = (a.visualTags || []).join(' ') + ' ' + t;
  const dv = /\b(?:DV|DoVi|Dolby[ .-]?Vision)\b/i.test(vis);
  const hdr = /\b(?:HDR10\+?|HDR|HLG)\b/i.test(vis);
  const tenBit = /\b10[ -]?bit\b/i.test(t);
  return {
    container: containerOf(source),
    video: videoCodecs(source, t),
    audio: audioCodecs(source, t),
    dv: dv,
    hdr: hdr,
    dvOnly: dv && !hdr,
    tenBit: tenBit,
  };
}

/**
 * Judge one source.
 * @returns {{source:object, playable:boolean, warn:boolean, reasons:string[]}}
 * `reasons` explains a rejection (playable false) or a soft warning (warn true).
 */
export function judge(source) {
  const reasons = [];
  let playable = true;
  let warn = false;
  if (source.Type === 'Placeholder') {
    return { source: source, playable: false, warn: false, reasons: ['Notice'] };
  }
  const f = describeSource(source);
  if (f.container && !CONTAINERS[f.container]) {
    playable = false;
    reasons.push('.' + f.container + ' container');
  }
  if (f.video.length) {
    let ok = false;
    for (let i = 0; i < f.video.length; i++) if (VIDEO[f.video[i]]) ok = true;
    if (!ok) {
      playable = false;
      reasons.push(f.video[0].toUpperCase() + ' video');
    }
  }
  if (f.audio.length) {
    let ok = false;
    let bad = '';
    for (let i = 0; i < f.audio.length; i++) {
      if (AUDIO[f.audio[i]]) ok = true;
      else if (!bad) bad = UNDECODABLE[f.audio[i]] || f.audio[i].toUpperCase();
    }
    if (!ok) {
      playable = false;
      reasons.push(bad ? bad + ' audio only' : 'No supported audio');
    }
  }
  if (playable && f.dvOnly) {
    warn = true;
    reasons.push('Dolby Vision only');
  }
  return { source: source, playable: playable, warn: warn, reasons: reasons };
}

/**
 * All sources, best first: clean playable ones in server order, then playable ones with a
 * warning (server order), then the rest (server order).
 */
export function rankSources(sources) {
  const list = sources || [];
  const good = [];
  const risky = [];
  const bad = [];
  for (let i = 0; i < list.length; i++) {
    const j = judge(list[i]);
    if (!j.playable) bad.push(j);
    else if (j.warn) risky.push(j);
    else good.push(j);
  }
  return good.concat(risky, bad);
}

/**
 * The source Play should start with, or null. When nothing passes the whitelist the first real
 * source is returned anyway (best effort: the TV may still manage it).
 */
export function pickSource(sources) {
  const ranked = rankSources(sources);
  if (!ranked.length) return null;
  for (let i = 0; i < ranked.length; i++) if (ranked[i].playable) return ranked[i].source;
  for (let i = 0; i < ranked.length; i++) if (ranked[i].source.Type !== 'Placeholder') return ranked[i].source;
  return null;
}

/** The next playable source after `current` in ranked order, or null (error fallback). */
export function nextSource(sources, current) {
  const ranked = rankSources(sources);
  let at = -1;
  for (let i = 0; i < ranked.length; i++) if (ranked[i].source === current || (current && ranked[i].source.Id === current.Id)) at = i;
  for (let i = at + 1; i < ranked.length; i++) if (ranked[i].playable) return ranked[i].source;
  return null;
}

/** Split a source's name into its (up to three) display lines. */
export function nameLines(source) {
  const raw = String(source.Name || (source.aiostreams && source.aiostreams.filename) || 'Source');
  const lines = raw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  return lines.length ? lines : ['Source'];
}

/** True for 4K/UHD sources (AVPlay needs SET_MODE_4K for them on a UHD panel). */
export function isUhd(source) {
  const a = source.aiostreams || {};
  if (/^(?:2160p?|4k|uhd)$/i.test(String(a.resolution || ''))) return true;
  const v = streamsOf(source, 'Video')[0];
  if (v && (v.Width >= 3000 || v.Height >= 2000)) return true;
  return /\b(?:2160p|4K|UHD)\b/i.test(String(source.Name || ''));
}
