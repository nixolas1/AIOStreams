// Norwegian original-language discovery; no geography or availability filtering.
import * as store from '../util/store.js';
export const PERIODS = [['year', 'This year'], ['month', 'This month'], ['all', 'All time']];
export const CATEGORIES = [['all', 'All'], ['drama', 'Drama / crime'], ['comedy', 'Comedy'], ['entertainment', 'Reality / entertainment'], ['documentary', 'Documentary']];
export const SOURCES = [['all', 'All'], ['nrk', 'NRK'], ['tv2', 'TV 2'], ['hbo', 'HBO / Max'], ['tvnorge', 'TVNorge'], ['viaplay', 'TV3 / Viaplay'], ['netflix', 'Netflix']];
export function label(list, value) {
  for (let i = 0; i < list.length; i++) if (list[i][0] === value) return list[i][1];
  return list[0][1];
}
function choice(key, list) {
  const value = store.get('discovery.norwegian.' + key, list[0][0]);
  return list.some(function (entry) { return entry[0] === value; }) ? value : list[0][0];
}
export function options() {
  return { period: choice('period', PERIODS), category: choice('category', CATEGORIES), source: choice('source', SOURCES),
    includeNews: store.get('discovery.norwegian.includeNews', false) === true };
}
export function enabled() {
  // Respect a previous explicit Off; all other old country choices become Norwegian shows.
  return store.get('discovery.norwegian.enabled', store.get('discovery.country', '') !== 'off') !== false;
}
export function set(key, value) { return store.set('discovery.norwegian.' + key, value); }
export function signature(now) {
  const o = options();
  const d = now || new Date();
  return [enabled(), o.period, o.category, o.source, o.includeNews, d.getFullYear(), d.getMonth(), d.getDate()].join('-');
}
export function rowId() { return 'norwegian-shows-' + signature(); }
export function title() {
  const o = options();
  const parts = ['Norske serier', label(PERIODS, o.period)];
  if (o.category !== 'all') parts.push(label(CATEGORIES, o.category));
  if (o.source !== 'all') parts.push(label(SOURCES, o.source));
  return parts.join(' · ');
}
