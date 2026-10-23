#!/usr/bin/env node
// Browser smoke test: boots the dev server, loads the app at 1920x1080 in
// Chromium, checks the Connect and Home screens render, and fails on any page
// error. Skips (exit 0) when no Playwright or Chromium can be found.
// Playwright is resolved from: PLAYWRIGHT_PATH, ./node_modules, then any
// ~/.npm/_npx/*/node_modules/playwright. Chromium: PLAYWRIGHT_CHROMIUM, or the
// newest ~/Library/Caches/ms-playwright (or ~/.cache/ms-playwright) browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../tools/devserver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..', '..');

function skip(why) {
  console.log('smoke: SKIPPED (' + why + ')');
  process.exit(0);
}

function findPlaywright() {
  const cands = [];
  if (process.env.PLAYWRIGHT_PATH) cands.push(process.env.PLAYWRIGHT_PATH);
  cands.push(path.join(pkgRoot, 'node_modules', 'playwright'));
  const npx = path.join(os.homedir(), '.npm', '_npx');
  if (fs.existsSync(npx)) for (const d of fs.readdirSync(npx)) cands.push(path.join(npx, d, 'node_modules', 'playwright'));
  for (const c of cands) {
    if (fs.existsSync(path.join(c, 'package.json'))) {
      try { return createRequire(path.join(c, 'package.json'))(c); } catch (e) { /* try next */ }
    }
  }
  return null;
}

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const bases = [path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright')];
  const exes = [];
  for (const b of bases) {
    if (!fs.existsSync(b)) continue;
    for (const d of fs.readdirSync(b).sort().reverse()) {
      if (!/^chromium(_headless_shell)?-\d+$/.test(d)) continue;
      const root = path.join(b, d);
      const walk = (dir, depth) => {
        if (depth > 6) return;
        for (const n of fs.readdirSync(dir)) {
          const p = path.join(dir, n);
          let st;
          try { st = fs.statSync(p); } catch (e) { continue; }
          if (st.isDirectory()) walk(p, depth + 1);
          else if (n === 'chrome-headless-shell' || n === 'Google Chrome for Testing' || n === 'chrome') exes.push(p);
        }
      };
      walk(root, 0);
    }
  }
  // prefer the headless shell
  exes.sort((a, b) => (/headless/.test(b) ? 1 : 0) - (/headless/.test(a) ? 1 : 0));
  return exes[0] || null;
}

const pw = findPlaywright();
if (!pw) skip('playwright package not found');
const exe = findChromium();
if (!exe) skip('no cached Chromium found');

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await pw.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
let failed = null;
try {
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  };

  // 1. Fresh profile: Connect screen.
  const ctx1 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p1 = await ctx1.newPage();
  watch(p1);
  await p1.goto(origin + '/');
  await p1.waitForSelector('[data-screen="connect"]', { timeout: 5000 });
  assert.equal(await p1.evaluate(() => document.documentElement.scrollWidth), 1920, 'canvas is 1920 wide');
  await p1.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 3000 });
  assert.equal(await p1.evaluate(() => (window.__errors || []).length), 0, 'no on-screen errors');
  // Back at the root exits (window.close is a no-op here) without throwing.
  await p1.keyboard.press('Escape');
  await ctx1.close();

  // 2. Signed-in profile against the mock server: Home screen.
  const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx2.addInitScript((base) => {
    try {
      if (!localStorage.getItem('atv.session')) {
        localStorage.setItem('atv.session', JSON.stringify({ base: base, token: 'mock-token', userId: 'mock-user', userName: 'Demo' }));
      }
    } catch (e) { /* ignore */ }
  }, origin + '/mock/jellyfin');
  const p2 = await ctx2.newPage();
  watch(p2);
  await p2.goto(origin + '/');
  await p2.waitForSelector('[data-screen="home"]', { timeout: 5000 });

  await p2.waitForFunction(() => !document.getElementById('splash'));

  // Norwegian discovery: real remote keys, filter requests, Back refresh, persistence and Off.
  const discoveryRequests = [];
  p2.on('request', (r) => { if (r.url().includes('/Discover/NorwegianShows')) discoveryRequests.push(new URL(r.url())); });
  await p2.evaluate(async () => {
    const nav = await import('/js/nav.js');
    nav.go('openSettings');
  });
  await p2.waitForSelector('[data-screen="settings"]');
  async function downTo(label) {
    for (let i = 0; i < 12; i++) {
      if (await p2.locator('.set-row.focus .set-label').textContent() === label) return;
      await p2.keyboard.press('ArrowDown'); await p2.waitForTimeout(40);
    }
    throw new Error('Setting not found: ' + label);
  }
  await downTo('Episodes aired');
  assert.match(await p2.locator('.set-row.focus').textContent(), /This year/);
  if (process.env.TV_REGION_SCREENSHOT) await p2.screenshot({ path: process.env.TV_REGION_SCREENSHOT });
  await p2.keyboard.press('ArrowRight');
  await p2.waitForFunction(() => document.querySelector('.set-row.focus').textContent.includes('This month'));
  await downTo('Category');
  await p2.keyboard.press('ArrowRight');
  await p2.waitForFunction(() => document.querySelector('.set-row.focus').textContent.includes('Drama / crime'));
  await downTo('Broadcaster');
  await p2.keyboard.press('ArrowRight');
  await p2.waitForFunction(() => document.querySelector('.set-row.focus').textContent.includes('NRK'));
  await p2.keyboard.press('Escape');
  await p2.waitForFunction(() => Array.from(document.querySelectorAll('.row-title')).some((e) => e.textContent === 'Norske serier · This month · Drama / crime · NRK'));
  assert.ok(discoveryRequests.some(u => u.searchParams.get('Period') === 'month' && u.searchParams.get('Category') === 'drama' && u.searchParams.get('Source') === 'nrk' && u.searchParams.get('IncludeNews') === 'false'));
  if (process.env.TV_NORWEGIAN_HOME_SCREENSHOT) {
    for (let i = 0; i < 2; i++) { await p2.keyboard.press('ArrowDown'); await p2.waitForTimeout(40); }
    for (let i = 0; i < 12; i++) { await p2.keyboard.press('ArrowUp'); await p2.waitForTimeout(40); }
    for (let i = 0; i < 10; i++) {
      const title = await p2.evaluate(() => { const el = document.querySelector('.row.active .row-title'); return el ? el.textContent : ''; });
      if (title.indexOf('Norske serier') === 0) break;
      await p2.keyboard.press('ArrowDown'); await p2.waitForTimeout(80);
    }
    assert.match(await p2.locator('.row.active .row-title').textContent(), /^Norske serier/);
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: process.env.TV_NORWEGIAN_HOME_SCREENSHOT });
  }
  await p2.evaluate(async () => (await import('/js/nav.js')).go('openSettings'));
  await downTo('Show Norske serier');
  await p2.keyboard.press('Enter');
  await p2.waitForFunction(() => document.querySelector('.set-row.focus').textContent.includes('Off'));
  await p2.keyboard.press('Escape');
  await p2.waitForFunction(() => !Array.from(document.querySelectorAll('.row-title')).some((e) => /Norske serier/.test(e.textContent)));
  await p2.reload();
  await p2.waitForSelector('[data-screen="home"]');
  assert.equal(await p2.evaluate(() => JSON.parse(localStorage.getItem('atv.discovery.norwegian.enabled'))), false);
  assert.equal(await p2.evaluate(() => JSON.parse(localStorage.getItem('atv.discovery.norwegian.source'))), 'nrk');

  // 3. API layer against the mock, from inside the page (real fetch, real modules).
  const api = await p2.evaluate(async () => {
    const jf = await import('/js/api/jellyfin.js');
    const client = await import('/js/api/client.js');
    const views = await jf.views();
    const first = await jf.items({ parentId: views.Items[0].Id, limit: 5 });
    const info = await jf.playbackInfo(first.Items[0].Id);
    const qc = await jf.quickConnectInitiate();
    const s1 = await jf.quickConnectState(qc.Secret);
    await jf.quickConnectState(qc.Secret);
    const s3 = await jf.quickConnectState(qc.Secret);
    const auth = await jf.authenticateQuickConnect(qc.Secret);
    const img = client.imageUrl(first.Items[0].Id, 'Primary', { width: 220, tag: 'x' });
    const imgOk = await new Promise((r) => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = img; });
    const resume = await jf.resume({ limit: 5 });
    const me = await jf.me();
    return {
      views: views.Items.map((v) => v.Name + ':' + v.CollectionType),
      firstCount: first.Items.length, total: first.TotalRecordCount,
      sources: info.MediaSources.length, firstAuth: s1.Authenticated, thirdAuth: s3.Authenticated,
      token: !!auth.AccessToken, imgOk: imgOk, resume: resume.Items.length, me: me.Name,
    };
  });
  assert.equal(api.views.length, 7);
  assert.ok(api.views.includes('Trending Movies:movies') && api.views.includes('Anime Kitsu Trending:tvshows'));
  assert.equal(api.firstCount, 5);
  assert.equal(api.total, 20);
  assert.equal(api.sources, 3);
  assert.equal(api.firstAuth, false);
  assert.equal(api.thirdAuth, true);
  assert.ok(api.token && api.imgOk);
  assert.equal(api.resume, 3);
  assert.equal(api.me, 'Demo');

  let markerRequests = 0;
  await p2.route('**/MediaSegments/*', async route => {
    markerRequests++;
    assert.equal(new URL(route.request().url()).searchParams.get('includeSegmentTypes'), 'Intro');
    if (markerRequests > 1) { await route.fulfill({ status: 503, body: '{}' }); return; }
    await route.fulfill({ json: { Items: [{ Type: 'Intro', StartTicks: 20000000, EndTicks: 60000000 }] } });
  });
  // Player controls against synthetic episodes, including remote focus and persisted size.
  await p2.evaluate(async () => {
    const jf = await import('/js/api/jellyfin.js');
    const router = await import('/js/router.js');
    const { PlayerScreen } = await import('/js/screens/player.js');
    const next = await jf.nextUp({ limit: 1 });
    router.push(PlayerScreen({ item: next.Items[0], opts: { startMs: 0 } }));
  });
  await p2.waitForSelector('.osd-next:not(.hidden)');
  await p2.waitForFunction(() => !document.querySelector('.spinner').classList.contains('on'));
  await p2.evaluate(async () => {
    const { top } = await import('/js/router.js');
    top().onKey('pause');
    const video = document.querySelector('video');
    await new Promise(resolve => { video.addEventListener('seeked', resolve, { once: true }); video.currentTime = 3; });
    top().onKey('back'); // hide overlay
  });
  assert.equal(await p2.locator('.osd-intro:not(.hidden)').count(), 0, 'no automatic intro prompt');
  await p2.evaluate(async () => { const { top } = await import('/js/router.js'); top().onKey('up'); });
  await p2.waitForSelector('.osd.on .osd-intro.focus');
  assert.equal(await p2.locator('.osd-next.focus').count(), 0, 'intro takes priority');
  if (process.env.TV_INTRO_SCREENSHOT) {
    await p2.waitForFunction(() => getComputedStyle(document.querySelector('.osd')).opacity === '1');
    await p2.screenshot({ path: process.env.TV_INTRO_SCREENSHOT });
  }
  await p2.evaluate(async () => {
    const video = document.querySelector('video');
    await new Promise(resolve => { video.addEventListener('seeked', resolve, { once: true }); video.currentTime = 7; });
  });
  await p2.waitForSelector('.osd-intro.hidden', { state: 'attached' });
  await p2.evaluate(async () => {
    const video = document.querySelector('video');
    await new Promise(resolve => { video.addEventListener('seeked', resolve, { once: true }); video.currentTime = 3; });
    const { top } = await import('/js/router.js'); top().onKey('up');
  });
  assert.equal(await p2.locator('.osd-intro.focus:not(.hidden)').count(), 1, 'seeking back makes intro available again');
  await p2.evaluate(async () => { const { top } = await import('/js/router.js'); top().onKey('enter'); });
  await p2.waitForFunction(() => document.querySelector('video').currentTime >= 5.9 && !document.querySelector('.spinner.on'));
  assert.equal(await p2.locator('video').evaluate(video => video.paused), true, 'skipping preserves pause');
  assert.equal(await p2.locator('.osd-intro:not(.hidden)').count(), 0, 'intro hides after skip');
  await p2.evaluate(async () => {
    const router = await import('/js/router.js');
    const player = router.top();
    player.onKey('info');
    player.onKey('up');
  });
  assert.equal(await p2.locator('.osd-next.focus').count(), 1);
  await p2.evaluate(async () => {
    const { top } = await import('/js/router.js');
    top().onKey('down'); // return from Next episode to transport
    top().onKey('down'); // open tracks
    top().onKey('right');
    top().onKey('right'); // font size
    top().onKey('down'); // default -> large
    top().onKey('enter');
  });
  assert.equal(await p2.locator('.subs').evaluate(el => getComputedStyle(el).fontSize), '56px');
  assert.equal(await p2.evaluate(() => JSON.parse(localStorage.getItem('atv.player.subSize'))), 56);
  await p2.evaluate(async () => {
    const { top } = await import('/js/router.js');
    top().onKey('down'); // tracks
    top().onKey('left'); top().onKey('right'); // subtitles column
    top().onKey('down'); top().onKey('enter'); // English
  });
  const before = await p2.locator('.osd-sub').textContent();
  await p2.evaluate(async () => {
    const { top } = await import('/js/router.js');
    top().onKey('info'); top().onKey('up'); top().onKey('enter');
  });
  await p2.waitForFunction(previous => document.querySelector('.osd-sub').textContent !== previous, before);
  assert.equal(await p2.locator('.subs').evaluate(el => getComputedStyle(el).fontSize), '56px');
  await p2.waitForFunction(() => !document.querySelector('.spinner').classList.contains('on'));
  await p2.evaluate(async () => { const { top } = await import('/js/router.js'); top().onKey('down'); });
  assert.match(await p2.locator('.tracks-col:nth-child(2) .tracks-opt').filter({ hasText: '✓' }).textContent(), /English/, 'next episode restores subtitle selection');
  await p2.evaluate(async () => { const { top } = await import('/js/router.js'); top().onKey('back'); });
  const watchedRequest = p2.waitForResponse(r => r.url().includes('/UserPlayedItems/') && r.request().method() === 'POST');
  await p2.evaluate(async () => {
    const { top } = await import('/js/router.js');
    top().onKey('pause');
    const video = document.querySelector('video');
    await new Promise(resolve => { video.addEventListener('seeked', resolve, { once: true }); video.currentTime = video.duration - 2; });
    top().onKey('stop');
    const hubs = await import('/js/api/hubs.js');
    await hubs.playbackSaved();
  });
  assert.equal((await watchedRequest).status(), 200, 'stopping at credits marks watched');
  const stop = server.playLog.filter(x => x.path.endsWith('/Stopped')).pop();
  assert.ok(stop.body.PositionTicks > 60000000, 'stop reports real video time');

  // Open a resumed episode; another episode in the same season was played more recently.
  await p2.route('**/mock/jellyfin/Items/ep-*', async route => {
    const response = await route.fetch();
    const item = await response.json();
    item.UserData = { PlaybackPositionTicks: 6000000000, LastPlayedDate: '2026-10-20T00:00:00Z' };
    await route.fulfill({ response, json: item });
  });
  await p2.route('**/mock/jellyfin/Shows/*/Episodes?*', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const ep of data.Items) if (ep.ParentIndexNumber === 2 && ep.IndexNumber === 4) {
      ep.UserData = { PlaybackPositionTicks: 6000000000, LastPlayedDate: '2026-10-22T00:00:00Z' };
    }
    await route.fulfill({ response, json: data });
  });
  const episode = await p2.evaluate(async () => {
    const jf = await import('/js/api/jellyfin.js');
    const { push } = await import('/js/router.js');
    const { DetailScreen } = await import('/js/screens/detail.js');
    const next = await jf.nextUp({ limit: 1 });
    const all = await jf.episodes(next.Items[0].SeriesId);
    const ep = all.Items.find(e => e.ParentIndexNumber === 2 && e.IndexNumber === 3);
    push(DetailScreen({ item: ep }));
    return ep;
  });
  await p2.waitForSelector('.detail-series-button .detail-btn');
  const geometry = await p2.evaluate(() => {
    const main = document.querySelector('.detail-buttons').getBoundingClientRect();
    const series = document.querySelector('.detail-series-button').getBoundingClientRect();
    return { bottom: main.bottom, top: series.top };
  });
  assert.ok(geometry.top > geometry.bottom, 'Go to series is below the other buttons');
  await p2.evaluate(async () => { const { top } = await import('/js/router.js'); top().onKey('down'); });
  assert.equal(await p2.locator('.detail-series-button .focus').textContent(), 'Go to series');
  if (process.env.TV_DETAIL_SCREENSHOT) await p2.screenshot({ path: process.env.TV_DETAIL_SCREENSHOT });
  await p2.evaluate(async () => { const { top } = await import('/js/router.js'); top().onKey('enter'); });
  await p2.waitForSelector('.detail .row.active');
  assert.equal(await p2.locator('.detail-seasons .current').last().textContent(), 'Season 2');
  const focusedId = await p2.evaluate(() => {
    const row = document.querySelector('.row.active');
    const tiles = Array.from(row.querySelectorAll('.tile'));
    return tiles.find(tile => Math.abs(tile.getBoundingClientRect().left - 96) < 2)._t.item.Id;
  });
  assert.equal(focusedId, episode.Id.replace(/e3$/, 'e4'), 'Go to series focuses the last-played episode');


  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  await ctx2.close();
  console.log('smoke: ok (' + path.basename(exe) + ')');
} catch (e) {
  failed = e;
}
await browser.close();
server.close();
if (failed) {
  console.error('smoke: FAILED\n' + (failed.stack || failed));
  process.exit(1);
}
