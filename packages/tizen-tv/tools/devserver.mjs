#!/usr/bin/env node
// Dev server: serves app/ on :8790 and a mock Jellyfin API under /mock/jellyfin
// (fixtures in tests/fixtures/). Open
//   http://localhost:8790/?server=/mock/jellyfin
// or point ?server= at a real AIOStreams /jellyfin (it must allow CORS).
// Node only, no dependencies. Never logs tokens.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixDir = path.join(root, 'tests', 'fixtures');
const MOCK = '/mock/jellyfin';

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(fixDir, f), 'utf8'));
const catalog = readJson('catalog.json');
const home = readJson('home.json');
const tpl = readJson('series-template.json');
const playbackInfo = readJson('playbackinfo.json');
const user = readJson('user.json');
const TICKS_MIN = 600000000;
const SRC_URL = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';
// Local 12 s VP8 clip (Chromium builds without H.264 can play it); served with Range support.
const LOCAL_VIDEO = path.join(fixDir, 'mock-video.webm');
const MOCK_VTT = 'WEBVTT\n\n00:00:00.500 --> 00:00:04.000\nMock subtitle line one\n\n00:00:05.000 --> 00:00:09.000\n<i>Mock subtitle</i> line two\n';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

function strip(t) {
  const o = Object.assign({}, t);
  delete o.kind;
  return o;
}

// Test hooks on the returned server: playLog, streamLog ([{session, source}] per stream request), infoLog ([{fresh, sourceId}] per PlaybackInfo request), POST /mock/jellyfin/__mock/expire (stream requests with a PlaySessionId issued before it answer 410; ?always=1 keeps every stream failing, ?always=0 resets), userLog (UserData/Rating calls), searchLog, knobs {searchDelayMs, searchStatus, userStatus}.
export function createServer(options = {}) {
  const appDir = options.appDir || path.join(root, 'app');
  // Seeded so the My list / Library rows have something to show.
  const favorites = new Set([catalog.items['view-trending-movies'][1], catalog.items['view-popular-series'][2]]);
  const playLog = []; // [{path, body}] of /Sessions/Playing* calls, for tests (never holds tokens)
  const played = new Set();
  const cleared = new Set();  // resume entries dismissed via POST /UserItems/:id/UserData {PlaybackPositionTicks: 0}
  const dropped = new Set();  // series dropped via POST /UserItems/:id/Rating?Likes=false (hidden from Next up)
  const userLog = [];         // [{method, path, query, body}] of those calls, for tests
  const searchLog = [];       // [{path, term}] of /Items?SearchTerm and /Search/Hints calls, for tests
  const knobs = { searchDelayMs: 0, searchStatus: 0, userStatus: 0 }; // tests: slow / failing search, failing dismiss
  const qc = { polls: 0 };
  const infoLog = [];         // [{fresh, sourceId}] of PlaybackInfo requests, for tests
  const streamLog = [];       // [{session, source}] of /Videos/:id/stream requests, for tests
  const sess = { issued: 0, expiredUpTo: 0, always: false }; // PlaySessionId numbering and the expire hook

  function withState(dto) {
    const o = strip(dto);
    o.UserData = Object.assign({}, o.UserData || {}, { IsFavorite: favorites.has(o.Id), Played: played.has(o.Id) });
    return o;
  }
  function episode(sr, season, ep) {
    return {
      Name: tpl.names[(ep - 1) % tpl.names.length], ServerId: 'mock-server',
      Id: 'ep-' + sr.Id + '-s' + season + 'e' + ep, Type: 'Episode', SeriesId: sr.Id, SeriesName: sr.Name,
      SeasonId: 'se-' + sr.Id + '-' + season, ParentIndexNumber: season, IndexNumber: ep,
      PremiereDate: '2024-06-15T00:00:00Z',
      ProductionYear: sr.ProductionYear, RunTimeTicks: 45 * TICKS_MIN, CommunityRating: 8.1,
      Overview: 'Mock episode ' + ep + ' of ' + sr.Name + '. The crew regroups after the events of the last hour.',
      ImageTags: { Primary: 't1' }, ParentBackdropImageTags: ['t1'], ParentLogoImageTag: 't1',
      UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false },
    };
  }
  function seasonsOf(sr) {
    const n = sr.ChildCount || tpl.seasons;
    const out = [];
    for (let i = 1; i <= n; i++) {
      out.push({ Name: 'Season ' + i, ServerId: 'mock-server', Id: 'se-' + sr.Id + '-' + i, Type: 'Season', SeriesId: sr.Id,
        SeriesName: sr.Name, IndexNumber: i, ImageTags: { Primary: 't1' }, UserData: { PlayCount: 0, IsFavorite: false, Played: false } });
    }
    return out;
  }
  function find(id) {
    if (catalog.titles[id]) return catalog.titles[id];
    let m = /^ep-(.+)-s(\d+)e(\d+)$/.exec(id);
    if (m && catalog.titles[m[1]]) return episode(catalog.titles[m[1]], +m[2], +m[3]);
    m = /^se-(.+)-(\d+)$/.exec(id);
    if (m && catalog.titles[m[1]]) return seasonsOf(catalog.titles[m[1]])[+m[2] - 1] || null;
    for (const arr of [home.resume, home.nextUp, home.upcoming]) {
      const f = arr.find((x) => x.Id === id);
      if (f) return f;
    }
    return null;
  }
  const list = (arr, start) => ({ Items: arr, TotalRecordCount: arr.length, StartIndex: start || 0 });

  function viewItems(id) {
    return (catalog.items[id] || []).map((tid) => withState(catalog.titles[tid]));
  }
  function allTitles() { return Object.keys(catalog.titles).map((id) => withState(catalog.titles[id])); }

  function handleItems(q) {
    let arr;
    if (q.parentid) arr = viewItems(q.parentid);
    else if ((q.filters || '').toLowerCase().includes('isplayed')) arr = allTitles().filter((t) => played.has(t.Id));
    else if ((q.filters || '').toLowerCase().includes('isfavorite')) arr = allTitles().filter((t) => favorites.has(t.Id));
    else arr = allTitles();
    if (q.includeitemtypes) {
      const types = q.includeitemtypes.toLowerCase().split(',');
      arr = arr.filter((t) => types.includes(String(t.Type).toLowerCase()));
    }
    if (q.genres) {
      const gs = q.genres.toLowerCase().split(/[,|]/);
      arr = arr.filter((t) => (t.Genres || []).some((g) => gs.includes(g.toLowerCase())));
    }
    if (q.searchterm) {
      const term = q.searchterm.toLowerCase();
      arr = arr.filter((t) => t.Name.toLowerCase().includes(term));
    }
    if (q.minpremieredate) {
      const min = Date.parse(q.minpremieredate);
      if (Number.isFinite(min)) arr = arr.filter((t) => Date.parse(t.PremiereDate) >= min);
    }
    if (q.sortby) {
      const key = q.sortby.split(',')[0];
      const dir = (q.sortorder || '').toLowerCase().startsWith('desc') ? -1 : 1;
      const val = (t) => key === 'CommunityRating' ? t.CommunityRating : key === 'PremiereDate' ? Date.parse(t.PremiereDate)
        : key === 'ProductionYear' ? t.ProductionYear : t.Name;
      arr = arr.slice().sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
    }
    const total = arr.length;
    const start = parseInt(q.startindex || '0', 10) || 0;
    const limit = parseInt(q.limit || '100', 10) || 100;
    return { Items: arr.slice(start, start + limit), TotalRecordCount: total, StartIndex: start };
  }

  function colorOf(id) {
    let hsh = 7;
    for (let i = 0; i < id.length; i++) hsh = (hsh * 31 + id.charCodeAt(i)) >>> 0;
    return hsh % 360;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function wrapWords(text, max) {
    const lines = [];
    let cur = '';
    for (const w of text.split(' ')) {
      if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }
  // Mock art: gradient plus soft shapes, like real key art. Only Primary posters (not episode stills)
  // carry the title, as a placeholder; Backdrop/Thumb have no text; Logo is a transparent wordmark.
  function svg(id, type) {
    const it = find(id);
    const name = it ? (it.Type === 'Episode' ? it.SeriesName : it.Name) : id;
    const key = it && it.SeriesId ? it.SeriesId : id;
    const hue = colorOf(key);
    const dims = { Primary: [400, 600], Backdrop: [1280, 720], Thumb: [640, 360], Logo: [800, 310] };
    let [w, h] = dims[type] || [400, 600];
    const still = type === 'Primary' && it && it.Type === 'Episode';
    if (still) [w, h] = [640, 360];
    if (type === 'Logo') {
      const lines = wrapWords(name, 16).slice(0, 2);
      const fs = lines.length > 1 ? 120 : 150;
      const lh = fs * 1.02;
      const y0 = h / 2 + (fs * 0.36) - ((lines.length - 1) * lh) / 2;
      const text = lines.map((l, i) => {
        const tl = Math.min(780, Math.round(l.length * fs * 0.5));
        return `<text x="0" y="${Math.round(y0 + i * lh)}" textLength="${tl}" lengthAdjust="spacingAndGlyphs" font-family="'Arial Narrow',Helvetica,Arial,sans-serif" font-weight="700" font-size="${fs}" fill="#fff7e6">${esc(l.toUpperCase())}</text>`;
      }).join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${text}</svg>`;
    }
    const h2 = (hue + 50) % 360;
    const h3 = (hue + 200) % 360;
    // Deterministic soft shapes derived from the id.
    let seed = hue * 977 + 13;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const shapes = [];
    for (let i = 0; i < 4; i++) {
      const cx = Math.round(rnd() * w);
      const cy = Math.round(rnd() * h);
      const r = Math.round((0.25 + rnd() * 0.4) * Math.max(w, h));
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#s${i % 2})" opacity="${(0.35 + rnd() * 0.4).toFixed(2)}"/>`);
    }
    const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,36%)"/><stop offset="1" stop-color="hsl(${h2},60%,14%)"/></linearGradient>` +
      `<radialGradient id="s0"><stop offset="0" stop-color="hsl(${h3},70%,62%)" stop-opacity="0.9"/><stop offset="1" stop-color="hsl(${h3},70%,62%)" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="s1"><stop offset="0" stop-color="hsl(${h2},80%,70%)" stop-opacity="0.8"/><stop offset="1" stop-color="hsl(${h2},80%,70%)" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0.4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs>`;
    let text = '';
    if (type === 'Primary' && !still) {
      const fs = Math.round(w / 11);
      const lines = wrapWords(name, 13);
      text = lines.map((l, i) => `<text x="${w * 0.08}" y="${h * 0.78 + i * fs * 1.1}" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="${fs}" fill="#fff7e6" opacity="0.92">${esc(l)}</text>`).join('');
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}<rect width="${w}" height="${h}" fill="url(#g)"/>${shapes.join('')}<rect width="${w}" height="${h}" fill="url(#v)"/>${text}</svg>`;
  }

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const s = Buffer.concat(chunks).toString('utf8');
    try { return s ? JSON.parse(s) : {}; } catch (e) { return {}; }
  }

  async function mock(req, res, url) {
    const p = decodeURIComponent(url.pathname.slice(MOCK.length)) || '/';
    const q = {};
    url.searchParams.forEach((v, k) => { q[k.toLowerCase()] = v; });
    const method = req.method;
    const send = (obj, status) => {
      res.writeHead(status || 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };
    const noContent = () => { res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end(); };
    let m;
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
      return res.end();
    }
    if (p === '/System/Info/Public') return send({ LocalAddress: MOCK, ServerName: 'Demo AIOStreams', Version: '10.10.0', ProductName: 'Jellyfin Server', Id: 'mock-server', StartupWizardCompleted: true });
    if (p === '/QuickConnect/Initiate') { qc.polls = 0; return send({ Authenticated: false, Secret: 'mock-secret', Code: '482913', DeviceName: 'Samsung TV', AppName: 'AIOStreams TV' }); }
    if (p === '/QuickConnect/Connect') {
      if (q.secret !== 'mock-secret') return send({ Message: 'Unknown secret' }, 404);
      qc.polls++;
      return send({ Authenticated: qc.polls > 2, Secret: 'mock-secret', Code: '482913' });
    }
    if (p === '/Users/AuthenticateWithQuickConnect') {
      const b = await body(req);
      if (b.Secret !== 'mock-secret' || qc.polls <= 2) return send({ Message: 'Not approved' }, 401);
      return send({ AccessToken: 'mock-token', User: user, ServerId: 'mock-server' });
    }
    if (p === '/Users/Me') return send(user);
    if (p === '/UserViews') return send(list(catalog.views));
    if (p === '/Discover/SeasonalAnime') return send(list(allTitles().filter((x) => /^ani/.test(x.Id)).slice(0, 20).map((x) => ({ ...x, AnimeDiscoveryLabel: 'AniList 75/100 · 21.3k users listed · Debut · 12 episodes' }))));
    if (p === '/Discover/NorwegianShows') return send(list(allTitles().filter((x) => x.Type === 'Series').slice(q.source === 'hbo' ? 10000 : 0, 20)));
    if (p === '/Discover/RegionalShows') return send(list(allTitles().filter((x) => x.Type === 'Series').slice(q.country === 'NO' ? 0 : 3, q.country === 'NO' ? 10 : 13)));
    if (p === '/UserItems/Resume') return send(list(q.parentid ? [] : home.resume.filter((r) => !cleared.has(r.Id)).map(withState)));
    if (p === '/Shows/NextUp') {
      let arr = home.nextUp.filter((e) => !dropped.has(e.SeriesId));
      if (q.seriesid) arr = arr.filter((e) => e.SeriesId === q.seriesid);
      return send(list(arr));
    }
    if (p === '/Shows/Upcoming') return send(list(home.upcoming));
    if (p === '/Items/Latest') {
      let arr = q.parentid ? viewItems(q.parentid) : allTitles();
      arr = arr.slice().sort((a, b) => Date.parse(b.PremiereDate) - Date.parse(a.PremiereDate));
      return send(arr.slice(0, parseInt(q.limit || '16', 10)));
    }
    if ((p === '/Items' || p === '/Users/' + user.Id + '/Items') && q.searchterm) {
      searchLog.push({ path: p, term: q.searchterm });
      if (knobs.searchDelayMs) await new Promise((r) => setTimeout(r, knobs.searchDelayMs));
      if (knobs.searchStatus) return send({ Message: 'Mock search failure' }, knobs.searchStatus);
    }
    if (p === '/Items' || p === '/Users/' + user.Id + '/Items') return send(handleItems(q));
    if (p === '/Genres') return send(list(catalog.genres.map((g) => ({ Name: g, Id: 'genre-' + g.toLowerCase(), Type: 'Genre' }))));
    if (p === '/Search/Hints') {
      searchLog.push({ path: p, term: q.searchterm || '' });
      const term = (q.searchterm || '').toLowerCase();
      const hits = allTitles().filter((t) => t.Name.toLowerCase().includes(term)).slice(0, 20);
      return send({ SearchHints: hits.map((t) => ({ ItemId: t.Id, Id: t.Id, Name: t.Name, Type: t.Type, ProductionYear: t.ProductionYear })), TotalRecordCount: hits.length });
    }
    if ((m = /^\/Shows\/([^/]+)\/Seasons$/.exec(p))) {
      const sr = catalog.titles[m[1]];
      return send(list(sr ? seasonsOf(sr) : []));
    }
    if ((m = /^\/Shows\/([^/]+)\/Episodes$/.exec(p))) {
      const sr = catalog.titles[m[1]];
      if (!sr) return send(list([]));
      let ms = q.seasonid ? /^se-.+-(\d+)$/.exec(q.seasonid) : null;
      const seasons = ms ? [+ms[1]] : seasonsOf(sr).map((s) => s.IndexNumber);
      const arr = [];
      for (const s of seasons) for (let e = 1; e <= tpl.episodesPerSeason; e++) arr.push(withState(episode(sr, s, e)));
      return send(list(arr));
    }
    if ((m = /^\/Items\/([^/]+)\/Similar$/.exec(p))) {
      const it = find(m[1]);
      const pool = allTitles().filter((t) => it && t.Id !== it.Id && t.Type === it.Type);
      return send(list(pool.slice(0, parseInt(q.limit || '20', 10))));
    }
    if ((m = /^\/Items\/([^/]+)\/Images\/([^/]+)(\/\d+)?$/.exec(p))) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600', 'Access-Control-Allow-Origin': '*' });
      return res.end(svg(m[1], m[2]));
    }
    if ((m = /^\/Items\/([^/]+)\/PlaybackInfo$/.exec(p)) && method === 'POST') {
      // Non-http Path: the client falls back to the stream route, which serves the local clip.
      const b = (await body(req)) || {};
      infoLog.push({ fresh: !!b.Fresh, sourceId: b.MediaSourceId || '' });
      const info = JSON.parse(JSON.stringify(playbackInfo));
      info.PlaySessionId = 'ps-' + (++sess.issued);
      for (const src of info.MediaSources) {
        src.Path = 'mock://' + src.Id;
        for (const st of src.MediaStreams || []) {
          if (st.Type === 'Subtitle') st.DeliveryUrl = '/Videos/' + m[1] + '/' + src.Id + '/Subtitles/' + st.Index + '/Stream.srt?ApiKey=mock';
        }
      }
      return send(info);
    }
    if (/^\/Videos\/[^/]+\/[^/]+\/Subtitles\/\d+\/Stream\.\w+$/.test(p)) {
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(MOCK_VTT);
    }
    if ((m = /^\/Items\/([^/]+)$/.exec(p)) || (m = /^\/Users\/[^/]+\/Items\/([^/]+)$/.exec(p))) {
      const it = find(m[1]);
      if (!it) return send({ Message: 'Not found' }, 404);
      const o = withState(it);
      // Resume progress follows the Continue watching list (cleared once dismissed).
      const r = home.resume.find((x) => x.Id === m[1]);
      if (r && !cleared.has(m[1])) o.UserData = Object.assign({}, o.UserData, { PlaybackPositionTicks: r.UserData.PlaybackPositionTicks, PlayedPercentage: r.UserData.PlayedPercentage });
      else if (r) o.UserData = Object.assign({}, o.UserData, { PlaybackPositionTicks: 0 });
      return send(o);
    }
    if (p === '/__mock/expire' && method === 'POST') {
      if (q.always != null) sess.always = q.always === '1';
      else sess.expiredUpTo = sess.issued;
      return noContent();
    }
    if (/^\/Videos\/[^/]+\/stream$/.test(p)) {
      const ps = q.playsessionid || '';
      streamLog.push({ session: ps, source: q.mediasourceid });
      const n = /^ps-(\d+)$/.exec(ps);
      if (sess.always || (n && Number(n[1]) <= sess.expiredUpTo)) { res.writeHead(410, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }
      if (!fs.existsSync(LOCAL_VIDEO)) { res.writeHead(302, { Location: SRC_URL }); return res.end(); }
      const size = fs.statSync(LOCAL_VIDEO).size;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      const head = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
      if (range) {
        const a = range[1] ? parseInt(range[1], 10) : 0;
        const b = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
        res.writeHead(206, Object.assign(head, { 'Content-Range': 'bytes ' + a + '-' + b + '/' + size, 'Content-Length': b - a + 1 }));
        return fs.createReadStream(LOCAL_VIDEO, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, Object.assign(head, { 'Content-Length': size }));
      return fs.createReadStream(LOCAL_VIDEO).pipe(res);
    }
    if (p.startsWith('/Sessions/Playing')) { playLog.push({ path: p, body: await body(req) }); return noContent(); }
    if ((m = /^\/UserItems\/([^/]+)\/UserData$/.exec(p)) && method === 'POST') {
      const b = await body(req);
      userLog.push({ method, path: p, query: Object.assign({}, q), body: b });
      if (knobs.userStatus) return send({ Message: 'Mock failure' }, knobs.userStatus);
      if (b.PlaybackPositionTicks === 0) cleared.add(m[1]);
      return send({ PlaybackPositionTicks: b.PlaybackPositionTicks || 0 });
    }
    if ((m = /^\/UserItems\/([^/]+)\/Rating$/.exec(p))) {
      userLog.push({ method, path: p, query: Object.assign({}, q) });
      if (knobs.userStatus) return send({ Message: 'Mock failure' }, knobs.userStatus);
      if (method === 'POST' && q.likes === 'false') dropped.add(m[1]);
      else if (method === 'DELETE') dropped.delete(m[1]);
      return send({ Likes: method === 'POST' ? q.likes === 'true' : null });
    }
    if ((m = /^\/UserPlayedItems\/([^/]+)$/.exec(p))) {
      if (method === 'POST') played.add(m[1]); else played.delete(m[1]);
      return send({ Played: method === 'POST' });
    }
    if ((m = /^\/UserFavoriteItems\/([^/]+)$/.exec(p))) {
      if (method === 'POST') favorites.add(m[1]); else favorites.delete(m[1]);
      return send({ IsFavorite: method === 'POST' });
    }
    return send({ Message: 'Mock: not implemented: ' + method + ' ' + p }, 404);
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.startsWith('/$WEBAPIS/')) {
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      return res.end('/* webapis stub (desktop) */');
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(appDir, rel));
    if (!file.startsWith(appDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === MOCK || url.pathname.startsWith(MOCK + '/')) {
      mock(req, res, url).catch((e) => { res.writeHead(500); res.end(String(e)); });
    } else serveStatic(req, res, url);
  });
  server.playLog = playLog;
  server.streamLog = streamLog;
  server.infoLog = infoLog;
  Object.defineProperty(server, 'infoCount', { get: () => sess.issued }); // PlaybackInfo responses served
  server.userLog = userLog;
  server.searchLog = searchLog;
  server.knobs = knobs;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8790);
  createServer().listen(port, () => {
    console.log(`dev server: http://localhost:${port}/?server=${MOCK}`);
  });
}
