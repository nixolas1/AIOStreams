import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, roleOf, viewsFor, recipesFor, homeRecipes, kindOf, tagItems, clearBrowseCache } from '../app/js/api/hubs.js';

const V = (Name, CollectionType, Id) => ({ Name, CollectionType, Id: Id || Name.toLowerCase().replace(/\W+/g, '-') });

test('roleOf realistic names', () => {
  const cases = {
    'Trending Movies': 'trending', 'TMDB Popular Series': 'popular', 'Netflix Movies': 'service:Netflix',
    'Top Rated Movies': 'top', 'Anime Kitsu Trending': 'trending', 'Kitsu Top Airing': 'new', 'New Anime': 'new',
    'Disney+ Series': 'service:Disney', 'Now Playing': 'new', 'On The Air': 'new', 'Upcoming Movies': 'upcoming',
    'IMDb Top 250': 'top', 'HBO Max Series': 'service:HBO', 'Action Movies': 'genre', 'Weird Stuff': 'other',
  };
  for (const n in cases) assert.equal(roleOf(n), cases[n], n);
});

test('classify kinds', () => {
  const out = classify([
    V('Trending Movies', 'movies'), V('TMDB Popular Series', 'tvshows'), V('Anime Kitsu Trending', 'tvshows'),
    V('Kitsu Top Airing', 'tvshows'), V('Mystery Box', undefined), V('Collections', 'boxsets'),
  ], {});
  const kinds = out.map((v) => v.kind);
  assert.deepEqual(kinds, ['movie', 'series', 'anime', 'anime', 'movie', 'movie']);
  assert.equal(out[3].role, 'new');
});

test('overrides: kind, role, hidden', () => {
  const out = classify([V('Trending Movies', 'movies', 'a'), V('Foo', 'movies', 'b')], { a: { kind: 'anime', hidden: true }, b: { role: 'top' } });
  assert.equal(out[0].kind, 'anime');
  assert.equal(out[0].hidden, true);
  assert.equal(out[1].role, 'top');
  assert.equal(viewsFor('anime').length, 0);
  assert.equal(viewsFor('movies').length, 1);
});

test('recipesFor movies order', () => {
  classify([
    V('Trending Movies', 'movies'), V('Netflix Movies', 'movies'), V('Top Rated Movies', 'movies'),
    V('Now Playing', 'movies'), V('Upcoming Movies', 'movies'), V('Action Movies', 'movies'),
  ], {});
  const ids = recipesFor('movies').map((r) => r.id);
  assert.deepEqual(ids.slice(0, 3), ['resume', 'trending', 'new']);
  assert.ok(ids.indexOf('upcoming') < ids.indexOf('because'));
  assert.ok(ids.indexOf('because') < ids.indexOf('top'));
  assert.equal(ids[ids.length - 1], 'genres');
  assert.ok(ids.some((i) => i.indexOf('svc-') === 0));
  assert.equal(recipesFor('movies').find((r) => r.id === 'trending').spotlight, 5);
  assert.ok(!ids.includes('fresh'));
});

test('recipesFor anime has airing row and no-new fallback', () => {
  classify([V('Anime Kitsu Trending', 'tvshows')], {});
  const ids = recipesFor('anime').map((r) => r.id);
  assert.ok(ids.includes('fresh'));
  assert.ok(ids.includes('new'));
  assert.equal(recipesFor('anime').find((r) => r.id === 'fresh').title, 'Airing now');
});

test('homeRecipes mixes kinds with badges', () => {
  classify([V('Trending Movies', 'movies'), V('Trending Series', 'tvshows'), V('Anime Kitsu Trending', 'tvshows')], {});
  const rs = homeRecipes();
  assert.deepEqual(rs.map((r) => r.id), ['resume', 'nextup', 'new-week', 'trending-movies', 'trending-series', 'airing-anime', 'because']);
  assert.ok(rs[0].badge && rs[0].tile === 'wide');
  assert.equal(rs[3].badge, false);
});

test('kindOf learns from tagged items', () => {
  tagItems([{ Id: 'ser1', Type: 'Series' }], 'anime');
  assert.equal(kindOf({ Id: 'ep1', Type: 'Episode', SeriesId: 'ser1' }), 'anime');
  assert.equal(kindOf({ Id: 'm1', Type: 'Movie' }), 'movie');
  assert.equal(kindOf({ Id: 'x', Type: 'Episode', SeriesId: 'unknown' }), 'series');
});

test('clearBrowseCache resets classification', () => {
  classify([V('Trending Movies', 'movies')], {});
  clearBrowseCache();
  assert.equal(viewsFor('movies').length, 0);
});
