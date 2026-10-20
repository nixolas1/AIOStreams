// Pure helpers for the browse page's hero (spotlight slideshow): slide wrap and zone transitions.

/** Index `delta` slides from `i` in a ring of `n` (0 when empty). */
export function wrapIndex(i, delta, n) {
  if (n <= 0) return 0;
  return (((i + delta) % n) + n) % n;
}

/**
 * Zone reached by `action` from `zone` ('nav' | 'hero' | 'rows') when the move leaves the zone, else ''.
 * `hasHero`: a spotlight exists. `top`: rows focus is on the first row (only `up`/`back` leave rows).
 */
export function nextZone(zone, action, hasHero, top) {
  if (zone === 'nav') return action === 'down' ? (hasHero ? 'hero' : 'rows') : '';
  if (zone === 'hero') {
    if (action === 'up' || action === 'back') return 'nav';
    return action === 'down' ? 'rows' : '';
  }
  if (top && (action === 'up' || action === 'back')) return hasHero ? 'hero' : 'nav';
  return '';
}
