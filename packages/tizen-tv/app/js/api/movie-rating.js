import * as store from '../util/store.js';

export const CHOICES = [0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
export function minimum() {
  const value = store.get('discovery.movieRating', 0);
  return CHOICES.indexOf(value) >= 0 ? value : 0;
}
export function setMinimum(value) { store.set('discovery.movieRating', CHOICES.indexOf(value) >= 0 ? value : 0); }
export function label() { return minimum() ? '★ ' + minimum().toFixed(1) + '+ / 10' : 'Any rating'; }
export function matches(item, threshold) {
  if (!threshold || item.Type !== 'Movie') return true;
  const rating = Number(item.CommunityRating);
  return isFinite(rating) && rating >= threshold && rating <= 10;
}

// Keep a raw server cursor separate from the displayed index, including sparse pages.
export function pager(fetchPage, keep) {
  let items = [], next = 0, done = false;
  let queue = Promise.resolve();
  return function (p) {
    const task = queue.then(async function () {
      const end = p.start + p.limit;
      while (!done && items.length < end) {
        const r = await fetchPage({ start: next, limit: 100 });
        next += r.items.length;
        done = !r.items.length || next >= r.total;
        items = items.concat(r.items.filter(keep));
      }
      return { items: items.slice(p.start, end), total: done ? items.length : Math.max(items.length, end + 1) };
    });
    queue = task.catch(function () {});
    return task;
  };
}
