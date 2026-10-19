// Mirrors how stremio-core decides what is in the library and what is
// "Continue Watching", so the import matches what the Stremio apps show.

const TYPES = new Set(['movie', 'series', 'anime']);

function ms(value) {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function watchlistEntry(item) {
  if (item.removed || item.temp || !TYPES.has(item.type)) return null;
  const entry = {
    type: item.type,
    kind: item.type === 'movie' ? 'movie' : 'series',
    metaId: item._id,
  };
  const at = ms(item._ctime);
  if (at !== undefined) entry.at = at;
  return entry;
}

function resumeEntry(item) {
  if (!TYPES.has(item.type)) return null;
  // A temp item is one played without being added; it still resumes.
  if (item.removed && !item.temp) return null;
  const state = item.state;
  if (!state || typeof state !== 'object') return null;
  const positionMs = num(state.timeOffset);
  if (positionMs <= 0) return null;

  const videoId =
    typeof state.video_id === 'string' && state.video_id ? state.video_id : null;
  // Without a distinct video id there is no episode to resume.
  if (item.type !== 'movie' && (!videoId || videoId === item._id)) return null;

  const entry = {
    type: item.type,
    metaId: item._id,
    videoId: videoId ?? item._id,
    positionMs,
  };
  const durationMs = num(state.duration);
  if (durationMs > 0) entry.durationMs = durationMs;
  const at = ms(state.lastWatched) ?? ms(item._mtime);
  if (at !== undefined) entry.at = at;
  return entry;
}

export function mapLibrary(
  library,
  { maxItems = 2000, maxWatchlist = 5000 } = {}
) {
  const items = [];
  const watchlist = [];
  for (const raw of Array.isArray(library) ? library : []) {
    // One bad entry must not cost the rest of the library.
    try {
      if (!raw || typeof raw._id !== 'string' || !raw._id) continue;
      const w = watchlistEntry(raw);
      if (w) watchlist.push(w);
      const r = resumeEntry(raw);
      if (r) items.push(r);
    } catch {
      continue;
    }
  }
  const newest = (a, b) => (b.at ?? 0) - (a.at ?? 0);
  items.sort(newest);
  watchlist.sort(newest);
  return {
    items: items.slice(0, maxItems),
    watchlist: watchlist.slice(0, maxWatchlist),
  };
}
