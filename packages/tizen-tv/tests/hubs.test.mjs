import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';

globalThis.localStorage = fakeStorage();
const session = await import('../app/js/session.js');
const { classify, roleOf, viewsFor, recipesFor, homeRecipes, kindOf, tagItems, clearBrowseCache, isAnimeItem, catalogOf, kindOfView } =
  await import('../app/js/api/hubs.js');
session.setBase('h:1');
session.signIn({ token: 'tok', userId: 'u', userName: 'N' });

const V = (Name, CollectionType, Id, Path) => ({ Name, CollectionType, Id: Id || Name.toLowerCase().replace(/\W+/g, '-'), Path });

// fetch double: route(url) -> JSON body. Records every request URL.
const calls = [];
function serve(route) {
  calls.length = 0;
  globalThis.fetch = async (url) => {
    calls.push(url);
    const body = route(new URL(url));
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}
const page = (all, u) => {
  const start = +u.searchParams.get('StartIndex') || 0;
  const limit = +u.searchParams.get('Limit') || 60;
  return { Items: all.slice(start, start + limit), TotalRecordCount: all.length };
};
const anime = (Id, extra) => Object.assign({ Id, Name: 'Anime ' + Id, Type: 'Series', Genres: ['Animation'], OriginalTitle: '\u685c\u306e\u65e5\u3005' }, extra);
const show = (Id, extra) => Object.assign({ Id, Name: 'Show ' + Id, Type: 'Series', Genres: ['Drama'] }, extra);

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
  assert.deepEqual(ids.slice(0, 4), ['resume', 'mylist', 'trending', 'new']);
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
  assert.deepEqual(rs.map((r) => r.id), ['resume', 'nextup', 'mylist', 'new-week', 'trending-movies', 'trending-series', 'airing-anime', 'because']);
  assert.ok(rs[0].badge && rs[0].tile === 'wide');
  assert.equal(rs[2].badge, true);
  assert.equal(rs[4].badge, false);
  assert.equal(rs[3].title, 'New releases');
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

test('catalogOf / kindOfView use the view Path', () => {
  assert.deepEqual(catalogOf({ Path: '/aiostreams/library/aiostreams::library.torbox' }), { type: 'library', catalog: 'aiostreams::library.torbox' });
  assert.equal(kindOfView(V('TorBox', undefined, 't', '/aiostreams/library/x')), 'library');
  assert.equal(kindOfView(V('Hot', 'tvshows', 'k', '/aiostreams/anime/kitsu.hot')), 'anime');
});

test('isAnimeItem heuristics', () => {
  assert.equal(isAnimeItem({ Id: 'h1', Type: 'Series', Genres: ['Anime'] }), true);
  assert.equal(isAnimeItem({ Id: 'h2', Type: 'Series', Genres: ['Animation'], ProductionLocations: ['Japan'] }), true);
  assert.equal(isAnimeItem({ Id: 'h3', Type: 'Series', Genres: ['Animation'], OriginalTitle: '\u9032\u6483' }), true);
  assert.equal(isAnimeItem({ Id: 'h4', Type: 'Series', Genres: ['Animation'], ProviderIds: { Kitsu: '1' } }), true);
  assert.equal(isAnimeItem({ Id: 'h5', Type: 'Series', Genres: ['Animation'], ProductionLocations: ['United States of America'], OriginalTitle: 'Bluey' }), false);
  assert.equal(isAnimeItem({ Id: 'h6', Type: 'Series', Genres: ['Drama'], ProductionLocations: ['Japan'], OriginalTitle: '\u9032\u6483' }), false);
  assert.equal(isAnimeItem(show('h7', { ProviderIds: { Tmdb: '1', Imdb: 'tt1', Tvdb: '2' } })), false);
});

test('tagItems turns anime in series views into anime and learns names and ids', () => {
  const a = anime('t-a1', { Name: 'Learned Title Z' });
  const plain = show('t-s1');
  tagItems([a, plain], 'series');
  assert.equal(a._kind, 'anime');
  assert.equal(plain._kind, 'series');
  // Same title without metadata (e.g. a different id) matches by learned name.
  assert.equal(isAnimeItem({ Id: 'other', Type: 'Series', Name: 'Learned  title z!' }), true);
  // Episodes resolve through the series id; a learned anime is never downgraded.
  assert.equal(kindOf({ Id: 'e', Type: 'Episode', SeriesId: 't-a1' }), 'anime');
  const again = { Id: 't-a1', Type: 'Series', Name: 'x' };
  tagItems([again], 'series');
  assert.equal(again._kind, 'anime');
  assert.equal(kindOf({ Id: 't-a1', Type: 'Series' }), 'anime');
});

test('library views are not learned', () => {
  const it = show('t-lib1');
  tagItems([it], 'library');
  assert.equal(it._kind, 'series');
  assert.equal(kindOf({ Id: 't-lib1', Type: 'Episode', SeriesId: 't-lib1' }), 'series');
  const m = { Id: 't-lib2', Type: 'Movie' };
  tagItems([m], 'library');
  assert.equal(m._kind, 'movie');
});

test('series hub rows drop anime and keep paging with their own cursor', async () => {
  classify([V('Trending Series', 'tvshows', 'ser-trend', '/aiostreams/series/tmdb.trending')], {});
  const all = [];
  for (let i = 0; i < 90; i++) all.push(i % 2 ? anime('p-a' + i) : show('p-s' + i));
  serve((u) => page(all, u));
  const row = recipesFor('series').find((r) => r.id === 'trending');
  const got = [];
  let r = await row.fetch({ start: 0, limit: 24 });
  assert.equal(r.items.length, 24);
  assert.ok(r.total > 24);
  got.push(...r.items);
  let guard = 0;
  while (got.length < r.total && guard++ < 10) {
    r = await row.fetch({ start: got.length, limit: 24 });
    if (!r.items.length) break;
    got.push(...r.items);
  }
  assert.equal(got.length, 45);
  assert.ok(got.every((it) => it._kind === 'series'));
  assert.equal(new Set(got.map((it) => it.Id)).size, 45);
  assert.equal(r.total, 45);
  // start 0 restarts from the first server page.
  calls.length = 0;
  r = await row.fetch({ start: 0, limit: 24 });
  assert.equal(r.items[0].Id, 'p-s0');
  assert.match(calls[0], /StartIndex=0/);
});

test('movie hub rows drop anime too', async () => {
  classify([V('Trending Movies', 'movies', 'mov-trend', '/aiostreams/movie/tmdb.trending')], {});
  const all = [{ Id: 'mm1', Name: 'Film', Type: 'Movie' }, { Id: 'mm2', Name: 'Jp Film', Type: 'Movie', Genres: ['Animation'], ProductionLocations: ['Japan'] }];
  serve((u) => page(all, u));
  const r = await recipesFor('movies').find((x) => x.id === 'trending').fetch({ start: 0, limit: 24 });
  assert.deepEqual(r.items.map((x) => x.Id), ['mm1']);
  assert.equal(r.total, 1);
});

test('New releases: one source per kind, no anime in movie/series, round-robin', async () => {
  classify([
    V('Trending Movies', 'movies', 'nr-m', '/aiostreams/movie/a'), V('Trending Series', 'tvshows', 'nr-s', '/aiostreams/series/b'),
    V('Anime Kitsu Trending', 'tvshows', 'nr-a', '/aiostreams/anime/c'),
  ], {});
  const day = 86400000;
  const mk = (pre, make, n) => Array.from({ length: n }, (_, i) =>
    make(pre + i, { Name: pre + i, PremiereDate: new Date(Date.now() - (i + 1) * day).toISOString() }));
  const byParent = {
    'nr-m': mk('m', (id, o) => Object.assign({ Id: id, Type: 'Movie' }, o), 10),
    'nr-s': [anime('sx', { PremiereDate: new Date(Date.now() - day).toISOString() })].concat(mk('s', show, 10)),
    'nr-a': mk('a', anime, 10),
  };
  serve((u) => page(byParent[u.searchParams.get('ParentId')], u));
  const r = await homeRecipes().find((x) => x.id === 'new-week').fetch();
  const ids = r.items.map((x) => x.Id);
  assert.deepEqual(ids.slice(0, 6), ['m0', 's0', 'a0', 'm1', 's1', 'a1']);
  assert.ok(!ids.includes('sx'));
  assert.equal(ids.length, 24);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => /MinPremiereDate=/.test(c)));
});

test('New releases falls back to newest when too few are recent', async () => {
  classify([V('Trending Movies', 'movies', 'old-m', '/aiostreams/movie/a')], {});
  const all = Array.from({ length: 10 }, (_, i) => ({ Id: 'o' + i, Type: 'Movie', Name: 'o' + i, PremiereDate: new Date(Date.UTC(2015, 0, 10 - i)).toISOString() }));
  all[9].PremiereDate = new Date(Date.UTC(2016, 0, 1)).toISOString();
  serve((u) => page(all, u));
  const r = await recipesFor('movies').find((x) => x.id === 'new').fetch();
  assert.equal(r.items[0].Id, 'o9');
  assert.equal(r.items.length, 10);
});

test('role list views go to Library, and recipesFor(library) layout', () => {
  classify([
    V('Trending Movies', 'movies', 'l-m', '/aiostreams/movie/a'), V('Watchlist', 'movies', 'l-w', '/aiostreams/movie/tmdb.watchlist'),
    V('TorBox', undefined, 'l-t', '/aiostreams/library/aiostreams::library.torbox'),
  ], {});
  assert.deepEqual(viewsFor('movies').map((v) => v.id), ['l-m']);
  assert.deepEqual(viewsFor('library').map((v) => v.id), ['l-t']);
  const rows = recipesFor('library');
  assert.deepEqual(rows.map((r) => r.id), ['resume', 'mylist', 'lib-l-t', 'lib-l-w', 'watched']);
  assert.ok(!rows.some((r) => r.chips));
  assert.equal(rows.find((r) => r.id === 'lib-l-t').title, 'Your TorBox library');
  assert.equal(rows.find((r) => r.id === 'lib-l-t').spotlight, 5);
  assert.ok(rows[0].badge && rows[1].badge);
  assert.deepEqual(recipesFor('movies').map((r) => r.id).slice(0, 2), ['resume', 'mylist']);
  assert.deepEqual(homeRecipes().map((r) => r.id).slice(0, 5), ['resume', 'nextup', 'mylist', 'lib-l-t', 'new-week']);
});

test('recipesFor(library) with nothing but favourites still spotlights My list', () => {
  classify([V('Trending Movies', 'movies', 'n-m', '/aiostreams/movie/a')], {});
  const rows = recipesFor('library');
  assert.deepEqual(rows.map((r) => r.id), ['resume', 'mylist', 'watched']);
  assert.equal(rows[1].spotlight, 5);
});


test('Continue watching waits for playback writes and returns one episode per series', async () => {
  const hubs = await import('../app/js/api/hubs.js');
  let complete;
  hubs.afterPlayback(new Promise(resolve => { complete = resolve; }));
  const old = { Id: 'old', Type: 'Episode', SeriesId: 'series-dedupe', UserData: { LastPlayedDate: '2026-10-20T00:00:00Z' } };
  const recent = { Id: 'recent', Type: 'Episode', SeriesId: 'series-dedupe', UserData: { LastPlayedDate: '2026-10-22T00:00:00Z' } };
  serve(() => ({ Items: [old, recent] }));
  const pending = homeRecipes().find(row => row.id === 'resume').fetch();
  await Promise.resolve();
  assert.equal(calls.length, 0, 'no stale fetch before stop completes');
  complete();
  assert.deepEqual((await pending).items.map(item => item.Id), ['recent']);
});
