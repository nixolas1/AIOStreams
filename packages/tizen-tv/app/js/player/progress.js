// Playback policy shared by Continue watching and the player.
export const CREDIT_MINUTES = [0, 1, 2, 3, 5, 10];
export function creditMinutes(value) { return CREDIT_MINUTES.indexOf(value) >= 0 ? value : 3; }
export function watchedAtStop(position, duration, minutes) {
  if (!isFinite(position) || !isFinite(duration) || duration <= 0 || position <= 0) return false;
  if (position >= duration) return true;
  return minutes > 0 && position >= duration / 2 && duration - position <= minutes * 60000;
}

export function lastPlayed(item) {
  return Date.parse(item.UserData && item.UserData.LastPlayedDate) || 0;
}

/** Newest episode per series; retain server order for missing/equal timestamps. */
export function latestResume(items, recent) {
  const seen = Object.create(null);
  return items.slice().sort(function (a, b) { return lastPlayed(b) - lastPlayed(a); }).filter(function (item) {
    const series = item.Type === 'Episode' && item.SeriesId;
    const key = series ? 'series:' + series : 'item:' + item.Id;
    if (seen[key]) return false;
    seen[key] = true;
    if (item.UserData && item.UserData.Played) return false;
    const local = series && recent && recent[series];
    // Don't resurrect an older unfinished episode after the newest one was completed here.
    if (local && lastPlayed(item) <= local.at && (local.played || local.id !== item.Id)) return false;
    return true;
  });
}
