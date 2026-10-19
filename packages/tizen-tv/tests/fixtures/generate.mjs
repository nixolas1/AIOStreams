// Regenerates the JSON fixtures the mock Jellyfin server (tools/devserver.mjs)
// serves. Deterministic; run: node tests/fixtures/generate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let seed = 42;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

const MOVIES = ['The Last Meridian', 'Neon Harbor', 'A Quiet Orbit', 'Paper Kingdoms', 'Salt and Static', 'The Long Thaw',
  'Midnight Cartographer', 'Glass Tide', 'Ember Road', 'Hollow Crown', 'Silver Lining Heist', 'Northbound',
  'The Archivist', 'Lanterns', 'Cold Harvest', 'Under the Pale Sun', 'Kestrel', 'Rust Belt Blues', 'Parallel Lines',
  'The Understudy', 'Wildfire Season', 'Afterglow', 'Thirteen Floors Down', 'Blue Hour', 'Iron Orchard', 'Low Tide Club',
  'The Cartwright Affair', 'Static Bloom', 'Dust and Diamonds', 'Harbor Lights'];
const SERIES = ['Signal Fire', 'The Ferryman', 'Common Ground', 'Deep Field', 'Roundhouse', 'Lowlands', 'Counterpoint',
  'The Bellwether', 'Saltmarsh', 'Dead Reckoning', 'Orchard Street', 'Night Shift Nine', 'Cinder County', 'The Understory',
  'Afterhours', 'Tidewater', 'Redline', 'The Quiet Room', 'Paperweight', 'Outpost 12'];
const ANIME = ['Skybound Chronicle', 'Crimson Lantern', 'Tsukimi Academy', 'Iron Blossom', 'Starlit Ronin', 'Echoes of Aether',
  'Blade of the Tide', 'Kitsune Detective', 'Mecha Frontier', 'Hollow Sakura', 'Clockwork Sparrow', 'Voltage Heart',
  'The Quiet Alchemist', 'Neon Samurai', 'Moonlit Ramen', 'Dragon Coast', 'Paper Crane Club', 'Zero Hour Pilot',
  'Summer Rift', 'Lost Shrine'];
const GENRES = ['Action', 'Drama', 'Comedy', 'Thriller', 'Sci-Fi', 'Fantasy', 'Animation', 'Adventure', 'Mystery', 'Crime'];
const RATINGS_M = ['PG', 'PG-13', 'R', 'PG-13', 'PG-13', 'R'];
const RATINGS_S = ['TV-14', 'TV-MA', 'TV-PG', 'TV-14'];
const SERVER_ID = 'mock-server';
const TICKS_MIN = 600000000;

function hex(n) { return n.toString(16).padStart(8, '0'); }

function title(kind, name, i) {
  const series = kind !== 'movie';
  const id = (kind === 'movie' ? 'mov' : kind === 'anime' ? 'ani' : 'ser') + hex(0xa1b2c3 + i * 7919);
  const year = 2008 + Math.floor(rnd() * 18);
  const genres = [pick(GENRES), pick(GENRES), pick(GENRES)].filter((g, k, a) => a.indexOf(g) === k);
  const dto = {
    Name: name,
    ServerId: SERVER_ID,
    Id: id,
    Type: series ? 'Series' : 'Movie',
    ProductionYear: year,
    PremiereDate: year + '-0' + (1 + Math.floor(rnd() * 9)) + '-1' + Math.floor(rnd() * 9) + 'T00:00:00.0000000Z',
    OfficialRating: series ? pick(RATINGS_S) : pick(RATINGS_M),
    CommunityRating: Math.round((5 + rnd() * 4) * 10) / 10,
    Genres: genres,
    Overview: name + ' follows an unlikely crew through a season they will not forget. Loyalties are tested, old debts come due, and nothing about the next move is simple. A mock summary long enough to wrap onto several lines of the detail screen so the clamp can be checked on a real TV.',
    ImageTags: { Primary: 't' + (i % 7), Logo: 't1' },
    BackdropImageTags: ['t' + (i % 5)],
    UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false },
    IsFolder: series,
    ProviderIds: { Tmdb: String(100000 + i) },
    RemoteTrailers: i % 3 === 0 ? [{ Url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', Name: 'Trailer' }] : [],
    kind: kind,
  };
  if (series) {
    dto.ChildCount = 1 + Math.floor(rnd() * 4);
    dto.Status = 'Continuing';
  } else {
    dto.RunTimeTicks = (80 + Math.floor(rnd() * 70)) * TICKS_MIN;
  }
  return dto;
}

const movies = MOVIES.map((n, i) => title('movie', n, i));
const series = SERIES.map((n, i) => title('series', n, 100 + i));
const anime = ANIME.map((n, i) => title('anime', n, 200 + i));

function slice(arr, from, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[(from + i) % arr.length]);
  return out;
}

// CollectionType values are what the real server emits: movies | tvshows | boxsets.
// A TMDB-tagged anime that shows up in a plain series catalog (the client must filter it out).
const lookalike = Object.assign(title('series', 'Sakura Dormitory Days', 300), {
  Genres: ['Animation', 'Comedy'], OriginalTitle: '\u685c\u5bee\u306e\u65e5\u3005', ProductionLocations: ['Japan'],
});
// Library items: debrid titles with no catalog metadata beyond the basics.
const libMovies = movies.slice(20, 24);
const libSeries = series.slice(14, 17);
const libraryPool = [...libMovies, ...libSeries];

const views = [
  { id: 'view-trending-movies', name: 'Trending Movies', type: 'movies', pool: movies, from: 0, path: 'movie/tmdb.trending' },
  { id: 'view-popular-series', name: 'Popular Series', type: 'tvshows', pool: [lookalike, ...series], from: 0, path: 'series/tmdb.trending' },
  { id: 'view-netflix-movies', name: 'Netflix Movies', type: 'movies', pool: movies, from: 9, path: 'movie/tmdb.netflix' },
  { id: 'view-anime-kitsu-trending', name: 'Anime Kitsu Trending', type: 'tvshows', pool: anime, from: 0, path: 'anime/kitsu.trending' },
  { id: 'view-top-rated-movies', name: 'Top Rated Movies', type: 'movies', pool: movies, from: 17, path: 'movie/tmdb.top' },
  { id: 'view-new-anime', name: 'New Anime', type: 'tvshows', pool: anime, from: 7, path: 'anime/kitsu.airing' },
  { id: 'view-library-torbox', name: 'TorBox', type: undefined, pool: libraryPool, from: 0, path: 'library/aiostreams::library.torbox' },
];
const catalog = {
  views: views.map((v) => ({
    Name: v.name, ServerId: SERVER_ID, Id: v.id, Type: 'CollectionFolder', CollectionType: v.type,
    IsFolder: true, ImageTags: {}, BackdropImageTags: [], Path: '/aiostreams/' + v.path,
  })),
  items: {},
  genres: GENRES,
};
for (const v of views) catalog.items[v.id] = slice(v.pool, v.from, 20).map((t) => t.Id);
catalog.titles = {};
for (const t of [...movies, ...series, ...anime, lookalike]) catalog.titles[t.Id] = t;

// Resume (one movie, two episodes), NextUp, Upcoming.
function episode(sr, season, ep, extra) {
  return Object.assign({
    Name: 'Episode ' + ep,
    ServerId: SERVER_ID,
    Id: 'ep-' + sr.Id + '-s' + season + 'e' + ep,
    Type: 'Episode',
    SeriesId: sr.Id,
    SeriesName: sr.Name,
    SeasonId: 'se-' + sr.Id + '-' + season,
    ParentIndexNumber: season,
    IndexNumber: ep,
    ProductionYear: sr.ProductionYear,
    RunTimeTicks: 45 * TICKS_MIN,
    CommunityRating: 8.1,
    Overview: 'Mock episode ' + ep + ' of ' + sr.Name + '.',
    ImageTags: { Primary: 't1' },
    ParentBackdropImageTags: ['t1'],
    ParentLogoImageTag: 't1',
    UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false },
  }, extra || {});
}
const resumeMovie = Object.assign({}, movies[3], {
  UserData: { PlaybackPositionTicks: 3000 * 600000, PlayedPercentage: 41.6, PlayCount: 0, IsFavorite: false, Played: false },
});
const home = {
  resume: [
    resumeMovie,
    episode(series[0], 1, 3, { UserData: { PlaybackPositionTicks: 1000 * 600000, PlayedPercentage: 22.2, PlayCount: 0, IsFavorite: false, Played: false } }),
    episode(anime[1], 1, 5, { UserData: { PlaybackPositionTicks: 1800 * 600000, PlayedPercentage: 66.7, PlayCount: 0, IsFavorite: false, Played: false } }),
  ],
  nextUp: [episode(series[1], 2, 1), episode(anime[3], 1, 2), episode(series[4], 1, 6)],
  upcoming: [episode(series[2], 3, 4), episode(anime[0], 2, 1)],
};

const NAMES = ['Pilot', 'The Long Way', 'Bad Weather', 'Crossing', 'Debts', 'Quiet Hours', 'Fault Lines', 'Homecoming'];
const seriesTemplate = { seasons: 4, episodesPerSeason: 8, names: NAMES };

const SRC_URL = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';
function src(n, name, o) {
  return {
    Id: 'src-' + n,
    Name: name,
    Path: o.path,
    Protocol: 'Http',
    Container: o.container,
    Size: o.size,
    Bitrate: o.bitrate,
    SupportsDirectPlay: true,
    SupportsDirectStream: true,
    SupportsTranscoding: false,
    IsRemote: true,
    DefaultAudioStreamIndex: 1,
    aiostreams: { id: 'ver-' + n },
    MediaStreams: [
      { Index: 0, Type: 'Video', Codec: o.vcodec, Width: o.w, Height: o.h, IsDefault: true, DisplayTitle: o.h + 'p ' + o.vcodec.toUpperCase() },
      { Index: 1, Type: 'Audio', Codec: o.acodec, Channels: o.ch, Language: 'eng', IsDefault: true, DisplayTitle: 'English ' + o.acodec.toUpperCase() },
      { Index: 2, Type: 'Subtitle', Codec: 'srt', Language: 'eng', IsExternal: true, IsTextSubtitleStream: true, DisplayTitle: 'English (SRT)', DeliveryMethod: 'External' },
    ],
  };
}
const playbackInfo = {
  PlaySessionId: 'mock-play-session',
  MediaSources: [
    src(1, '4K · Remux · 42.1 GB · Cached\nHEVC · HDR10 · TrueHD 7.1\nEnglish · Torrentio · FraMeSToR',
      { path: SRC_URL, container: 'mkv', size: 42100000000, bitrate: 52000000, vcodec: 'hevc', w: 3840, h: 2160, acodec: 'truehd', ch: 8 }),
    src(2, '1080p · WEB-DL · 6.4 GB · Cached\nH264 · DDP5.1\nEnglish · Comet · NTb',
      { path: SRC_URL, container: 'mp4', size: 6400000000, bitrate: 9500000, vcodec: 'h264', w: 1920, h: 1080, acodec: 'eac3', ch: 6 }),
    src(3, '1080p · BluRay · 12.8 GB · Uncached\nHEVC · DTS-HD MA 5.1\nEnglish · MediaFusion · SPARKS',
      { path: null, container: 'mkv', size: 12800000000, bitrate: 18000000, vcodec: 'hevc', w: 1920, h: 1080, acodec: 'dts', ch: 6 }),
  ],
};

const write = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o, null, 1) + '\n');
write('catalog.json', catalog);
write('home.json', home);
write('series-template.json', seriesTemplate);
write('playbackinfo.json', playbackInfo);
write('user.json', { Name: 'Demo', Id: 'mock-user', ServerId: SERVER_ID, HasPassword: false });
console.log('fixtures written:', Object.keys(catalog.titles).length, 'titles,', views.length, 'views');
