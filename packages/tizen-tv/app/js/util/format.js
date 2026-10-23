// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Formatting for Jellyfin BaseItemDto fields. Ticks are 100 ns units.
const TICKS_PER_MS = 10000;

// 6360000000 ticks -> "1h 46m"; under an hour -> "46m"; nothing -> ''.
export function duration(ticks) {
  if (!ticks) return '';
  const min = Math.round(ticks / TICKS_PER_MS / 60000);
  if (min < 1) return '';
  if (min < 60) return min + 'm';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

// Milliseconds -> "1:02:03" or "2:03".
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return (hh ? hh + ':' + pad(mm) : String(mm)) + ':' + pad(ss);
}

// Wall-clock time (24 h "21:42") at which something with remainingMs left ends.
export function endsAt(remainingMs, now) {
  const d = new Date((now == null ? Date.now() : now) + Math.max(0, remainingMs));
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Episodes: "S1 · E2". Anything else (or missing numbers): ''.
export function episodeLabel(item) {
  if (!item || item.Type !== 'Episode') return '';
  const s = item.ParentIndexNumber;
  const e = item.IndexNumber;
  if (s == null && e == null) return '';
  return (s != null ? 'S' + s : '') + (s != null && e != null ? ' · ' : '') + (e != null ? 'E' + e : '');
}

// "2008  ·  PG-13  ·  1h 46m  ·  ★ 5.8" (series: "N seasons" instead of runtime).
export function metaLine(item) {
  const parts = [];
  if (!item) return '';
  if (item.Type === 'Episode') {
    const label = episodeLabel(item);
    if (label) parts.push(label);
  } else if (item.ProductionYear) {
    parts.push(item.ProductionYear);
  }
  if (item.OfficialRating) parts.push(item.OfficialRating);
  if (item.Type === 'Series') {
    if (item.ChildCount) parts.push(item.ChildCount + (item.ChildCount === 1 ? ' season' : ' seasons'));
  } else {
    const d = duration(item.RunTimeTicks);
    if (d) parts.push(d);
  }
  if (item.CommunityRating) parts.push('★ ' + Number(item.CommunityRating).toFixed(1));
  return parts.join('  ·  ');
}

// 0..1 watched fraction (0 when unstarted or finished).
export function progressFraction(item) {
  const ud = item && item.UserData;
  if (!ud) return 0;
  let f = 0;
  if (ud.PlayedPercentage != null) f = ud.PlayedPercentage / 100;
  else if (ud.PlaybackPositionTicks && item.RunTimeTicks) f = ud.PlaybackPositionTicks / item.RunTimeTicks;
  if (!(f > 0) || f >= 1) return 0;
  return f;
}

// Air dates use UTC calendar days so midnight dates do not shift with TV timezone.
export function aired(date, now) {
  if (!date) return '';
  const air = new Date(date);
  const today = new Date(now == null ? Date.now() : now);
  if (!isFinite(air.getTime()) || !isFinite(today.getTime())) return '';
  const day = function (d) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const days = Math.floor((day(today) - day(air)) / 86400000);
  const monthYear = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][air.getUTCMonth()] + ' ' + air.getUTCFullYear();
  if (days < 0) return 'Airs ' + monthYear;
  // Clamp the three-month anniversary to the last day of shorter months.
  const end = new Date(Date.UTC(air.getUTCFullYear(), air.getUTCMonth() + 4, 0));
  const cutoff = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(air.getUTCDate(), end.getUTCDate()));
  if (day(today) > cutoff) return monthYear;
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 7) return days + ' days ago';
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks + (weeks === 1 ? ' week ago' : ' weeks ago');
  }
  const months = day(today) === cutoff ? 3 : Math.min(3, Math.floor(days / 30));
  return months + (months === 1 ? ' month ago' : ' months ago');
}
