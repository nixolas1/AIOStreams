#!/usr/bin/env node
// Detail / sources / player browser test against the mock server: movie detail buttons, Sources
// panel (ranking, DTS dimmed), playing in the <video> fallback (local VP8 clip) with OSD, seek
// preview, track panel with an external subtitle, progress reports, Back restoring detail focus,
// series seasons + episodes, up-next card. Saves out/screens/{detail-movie,detail-series,sources,player-osd}.png.
// Playwright / Chromium resolution is the same as smoke.mjs. Skips (exit 0) when either is missing.
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
  console.log('detail: SKIPPED (' + why + ')');
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
const shots = path.join(pkgRoot, 'out', 'screens');
fs.mkdirSync(shots, { recursive: true });

const browser = await pw.chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
let failed = null;
try {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript((base) => {
    try {
      if (!localStorage.getItem('atv.session')) {
        localStorage.setItem('atv.session', JSON.stringify({ base: base, token: 'mock-token', userId: 'mock-user', userName: 'Demo' }));
      }
    } catch (e) { /* ignore */ }
  }, origin + '/mock/jellyfin');
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

  const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(60); } };
  const text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
  const texts = (sel) => page.evaluate((s) => Array.prototype.map.call(document.querySelectorAll(s), (e) => e.textContent), sel);
  const open = (id) => page.evaluate(async (i) => {
    const nav = await import('/js/nav.js');
    const jf = await import('/js/api/jellyfin.js');
    nav.go('openItem', await jf.item(i));
  }, id);
  const settle = (ms) => page.waitForTimeout(ms || 500);

  await page.goto(origin + '/');
  await page.waitForSelector('[data-screen="home"]', { timeout: 5000 });

  // ---------- movie detail ----------
  await open('mov00a1b2c3');
  await page.waitForSelector('[data-screen="detail"]:not(.hidden) .detail-btn', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.detail:not(.hidden) .detail-meta').textContent.length > 0);
  await settle(700);
  let labels = await texts('.detail:not(.hidden) .detail-btn');
  assert.deepEqual(labels, ['Play', 'Sources', 'Trailer', 'Watchlist', 'Mark watched'], 'buttons: ' + labels);
  assert.equal(await text('.detail:not(.hidden) .detail-title'), 'The Last Meridian');
  assert.ok((await text('.detail:not(.hidden) .detail-summary')).length > 50, 'summary');
  assert.equal(await page.evaluate(() => document.querySelector('.detail:not(.hidden) .detail-btn.focus').textContent), 'Play');
  await page.screenshot({ path: path.join(shots, 'detail-movie.png') });

  // Watchlist toggles through the mock server.
  await key('ArrowRight', 3);
  assert.equal(await text('.detail:not(.hidden) .detail-btn.focus'), 'Watchlist');
  await key('Enter');
  await page.waitForFunction(() => /✓ Watchlist/.test(document.querySelector('.detail:not(.hidden) .detail-btn.focus').textContent));
  await key('Enter');
  await page.waitForFunction(() => document.querySelector('.detail:not(.hidden) .detail-btn.focus').textContent === 'Watchlist');
  await key('ArrowLeft', 2);

  // Down moves into "More like this" and slides the body up; Up/Back return.
  await key('ArrowDown');
  await settle(500);
  assert.ok(await page.evaluate(() => document.querySelector('.detail:not(.hidden)').classList.contains('shifted')), 'body shifted');
  assert.ok(await page.evaluate(() => document.querySelector('.detail:not(.hidden) .row.active')), 'similar row active');
  await page.screenshot({ path: path.join(shots, 'detail-similar.png') });
  await key('Escape');
  await settle(400);
  assert.ok(!(await page.evaluate(() => document.querySelector('.detail:not(.hidden)').classList.contains('shifted'))), 'shifted cleared');
  assert.equal(await text('.detail:not(.hidden) .detail-btn.focus'), 'Sources');

  // ---------- sources panel ----------
  await key('Enter');
  await page.waitForSelector('.sources.in .src-row', { timeout: 5000 });
  await settle(500);
  assert.equal((await texts('.sources .src-row')).length, 3);
  const dim = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.sources .src-row'), (r) => r.classList.contains('dim')));
  // Ranked: the h264 + EAC3 web-dl first, then the TrueHD-only remux and the DTS-only BluRay (both dimmed).
  assert.deepEqual(dim, [false, true, true], 'dimmed rows ' + dim);
  assert.ok((await text('.sources .src-row .src-chip.good')).indexOf('Recommended') === 0);
  await page.screenshot({ path: path.join(shots, 'sources.png') });

  // ---------- play the first (recommended) source ----------
  await key('Enter');
  await page.waitForSelector('[data-screen="player"]', { timeout: 5000 });
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('playing')), 'html.playing');
  const played = await page.waitForFunction(() => {
    const v = document.querySelector('video.av-object');
    return !!v && v.currentTime > 0.6 && !v.paused;
  }, null, { timeout: 15000 }).then(() => true, () => false);
  assert.ok(played, 'the local clip plays');
  assert.equal(await text('.player .osd-title'), 'The Last Meridian');
  await key('ArrowUp');
  await page.waitForSelector('.player .osd.on');
  await settle(400);
  await page.screenshot({ path: path.join(shots, 'player-osd.png') });
  assert.ok(/^\d/.test(await text('.player .osd-now')));
  assert.ok(/Ends at \d\d:\d\d/.test(await text('.player .osd-info')));

  // Seek preview: two presses add 20 s (clamped by the 12 s clip), the label shows, then it commits.
  await key('ArrowLeft', 1);
  assert.ok(await page.evaluate(() => document.querySelector('.player .osd').classList.contains('seeking')), 'seek preview');
  await page.waitForFunction(() => !document.querySelector('.player .osd').classList.contains('seeking'), null, { timeout: 4000 });

  // Track panel: Down opens it; pick the external English subtitle.
  await key('ArrowDown');
  await page.waitForSelector('.player .tracks:not(.hidden)');
  const subs = await texts('.player .tracks-col:nth-child(2) .tracks-label');
  assert.equal(subs[0], 'Off');
  assert.ok(/English/.test(subs[1]), 'external subtitle listed: ' + subs);
  await key('ArrowDown');
  await key('Enter');
  await page.waitForSelector('.player .tracks.hidden', { state: 'attached' });
  const sawSub = await page.waitForFunction(() => /Mock subtitle/.test(document.querySelector('.player .subs').textContent), null, { timeout: 12000 }).then(() => true, () => false);
  assert.ok(sawSub, 'external subtitle drawn');

  // Progress reports reached the server.
  await settle(300);
  assert.ok(server.playLog.some((e) => e.path === '/Sessions/Playing'), 'reportStart');
  const start = server.playLog.find((e) => e.path === '/Sessions/Playing');
  assert.equal(start.body.MediaSourceId, 'ver-2');
  assert.equal(start.body.ItemId, 'mov00a1b2c3');
  assert.ok(start.body.PlaySessionId);

  // Back: first Back hides the OSD, the next one leaves playback and reports the stop.
  await key('ArrowUp');
  await page.waitForSelector('.player .osd.on');
  await key('Escape');
  await page.waitForFunction(() => !document.querySelector('.player .osd.on'));
  await key('Escape');
  await page.waitForSelector('[data-screen="player"]', { state: 'detached', timeout: 3000 });
  await settle(400);
  assert.ok(!(await page.evaluate(() => document.documentElement.classList.contains('playing'))), 'html.playing cleared');
  assert.ok(server.playLog.some((e) => e.path === '/Sessions/Playing/Stopped'), 'reportStopped');
  const stop = server.playLog.find((e) => e.path === '/Sessions/Playing/Stopped');
  assert.ok(stop.body.PositionTicks > 0, 'stopped position reported');
  // The detail screen is back with focus where it was (Sources button).
  assert.equal(await text('.detail:not(.hidden) .detail-btn.focus'), 'Sources');

  // ---------- series detail ----------
  await page.keyboard.press('Escape'); // detail -> home
  await page.waitForSelector('[data-screen="detail"]', { state: 'detached', timeout: 3000 });
  const seriesId = await page.evaluate(async () => {
    const jf = await import('/js/api/jellyfin.js');
    return (await jf.items({ includeItemTypes: 'Series', limit: 1 })).Items[0].Id;
  });
  await open(seriesId);
  await page.waitForSelector('.detail:not(.hidden) .pill', { timeout: 5000 });
  await page.waitForSelector('.detail:not(.hidden) .tile-episode', { timeout: 5000 });
  await settle(700);
  const pills = await texts('.detail:not(.hidden) .pill');
  assert.ok(pills.length >= 2 && /^Season 1/.test(pills[0]), 'seasons: ' + pills);
  labels = await texts('.detail:not(.hidden) .detail-btn');
  assert.ok(/^Play /.test(labels[0]), 'series play label: ' + labels[0]);
  await key('ArrowDown');
  await settle(500);
  assert.ok(await page.evaluate(() => document.querySelector('.detail:not(.hidden)').classList.contains('shifted')));
  await key('ArrowRight');
  await page.waitForFunction(() => document.querySelectorAll('.detail:not(.hidden) .pill')[1].classList.contains('focus'));
  await settle(900);
  await page.screenshot({ path: path.join(shots, 'detail-series.png') });
  await key('ArrowDown');
  await settle(400);
  assert.ok(await page.evaluate(() => !!document.querySelector('.detail:not(.hidden) .row.active .tile-episode')), 'episodes row active');

  // ---------- up next: start an episode 1.5 s before the clip ends; the card appears ----------
  await page.evaluate(async (sid) => {
    const nav = await import('/js/nav.js');
    const jf = await import('/js/api/jellyfin.js');
    const eps = await jf.episodes(sid);
    nav.go('playItem', eps.Items[0], { startMs: 10300 });
  }, seriesId);
  await page.waitForSelector('.player .upnext:not(.hidden)', { timeout: 20000 });
  assert.ok(/Up next in \d+/.test(await text('.player .upnext-label')), 'up-next countdown');
  assert.ok(/E2/.test(await text('.player .upnext-title')), 'next episode named: ' + (await text('.player .upnext-title')));
  await page.screenshot({ path: path.join(shots, 'player-upnext.png') });
  await key('Enter'); // play now: replaces the player with episode 2
  await page.waitForFunction(() => /E2/.test(document.querySelector('.player .osd-sub').textContent), null, { timeout: 8000 });
  await key('Escape');
  await key('Escape');
  await page.waitForSelector('[data-screen="player"]', { state: 'detached', timeout: 5000 });

  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  await ctx.close();
  console.log('detail: ok (' + path.basename(exe) + ')');
} catch (e) {
  failed = e;
}
await browser.close();
server.close();
if (failed) {
  console.error('detail: FAILED\n' + (failed.stack || failed));
  process.exit(1);
}
