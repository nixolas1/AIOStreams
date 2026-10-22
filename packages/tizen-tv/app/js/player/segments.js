// Only accept complete intro markers inside the actual source duration.
export function introSegments(response, duration) {
  if (!isFinite(duration) || duration <= 0) return [];
  const items = response && Array.isArray(response.Items) ? response.Items : [];
  return items.filter(function (s) {
    return s && s.Type === 'Intro' && typeof s.StartTicks === 'number' && typeof s.EndTicks === 'number' &&
      isFinite(s.StartTicks) && isFinite(s.EndTicks) && s.StartTicks >= 0 && s.EndTicks > s.StartTicks &&
      s.EndTicks / 10000 < duration;
  }).map(function (s) { return { start: s.StartTicks / 10000, end: s.EndTicks / 10000 }; })
    .sort(function (a, b) { return a.start - b.start; });
}

export function introAt(segments, time) {
  for (let i = 0; i < segments.length; i++) {
    if (time >= segments[i].start && time < segments[i].end) return segments[i];
  }
  return null;
}
