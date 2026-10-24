import * as store from '../util/store.js';
export const SORTS = [['trending', 'Trending now'], ['popular', 'Most listed'], ['rating', 'Highest rated'], ['newest', 'Newest premiere']];
export const MINIMUMS = [[0, 'Any score'], [60, '60/100+'], [70, '70/100+'], [80, '80/100+']];
export function options() {
  const sort = store.get('discovery.anime.sort', 'trending');
  const minimum = store.get('discovery.anime.minimum', 0);
  return { sort: SORTS.some(function (x) { return x[0] === sort; }) ? sort : 'trending',
    minimum: MINIMUMS.some(function (x) { return x[0] === minimum; }) ? minimum : 0 };
}
export function season(now) {
  const d = now || new Date();
  return ['Winter', 'Spring', 'Summer', 'Fall'][Math.floor(d.getUTCMonth() / 3)] + ' ' + d.getUTCFullYear();
}
export function signature() { const o = options(); return season() + '-' + o.sort + '-' + o.minimum; }
export function set(key, value) { store.set('discovery.anime.' + key, value); }
export const ROWS = [
  ['debuts', 'New anime'], ['fantasy', 'Magic, fantasy & leveling up'],
  ['returning', 'Your favorites returning'], ['quiet', 'Quieter fantasy & strange worlds'],
  ['sequels', 'More returning anime'],
];
