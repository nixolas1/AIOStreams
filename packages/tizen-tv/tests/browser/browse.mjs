#!/usr/bin/env node
// Browse test: Home/hub rows, D-pad focus, detail open and Back, tab switch to Anime. Saves out/screens/{home,anime}.png.
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
  console.log('browse: SKIPPED (' + why + ')');
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
const outDir = path.join(pkgRoot, 'out', 'screens');
fs.mkdirSync(outDir, { recursive: true });

const browser = await pw.chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
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
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
  const rowsInfo = () => page.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('[data-screen="home"]:not(.hidden) .row, [data-screen="hub"]:not(.hidden) .row'));
    return vis.map((r) => ({
      title: r.querySelector('.row-title').textContent,
      tiles: r.querySelectorAll('.tile').length,
      imgs: Array.from(r.querySelectorAll('.tile-img.in')).length,
      active: r.classList.contains('active'),
      tx: r.querySelector('.row-track').style.transform,
    }));
  });

  await page.goto(origin + '/');
  await page.waitForSelector('[data-screen="home"] .row .tile-img.in', { timeout: 8000 });
  await page.waitForTimeout(900);

  // topbar
  const bar = await page.evaluate(() => ({
    items: Array.from(document.querySelectorAll('.topbar .nav-item')).map((e) => e.textContent.trim()),
    word: document.querySelector('.brand-word').textContent.trim(),
  }));
  assert.deepEqual(bar.items.slice(0, 4), ['Home', 'Movies', 'Series', 'Anime']);
  assert.equal(bar.items.length, 6);
  assert.ok(/AIOStreams/.test(bar.word));

  // rows with images
  let rows = await rowsInfo();
  assert.ok(rows.length >= 4, 'at least 4 rows, got ' + rows.map((r) => r.title).join(','));
  assert.ok(rows.filter((r) => r.imgs > 0).length >= 4, 'rows with images: ' + JSON.stringify(rows));
  assert.ok(rows[0].active, 'first row active');
  assert.equal(rows[0].title, 'Continue watching');

  // hero shows text
  const hero = await page.evaluate(() => ({ t: document.querySelector('[data-screen="home"] .hero-title').textContent, meta: document.querySelector('[data-screen="home"] .hero-meta').textContent }));
  assert.ok(hero.t.length > 0 && hero.meta.length > 0, 'hero text ' + JSON.stringify(hero));
  await page.screenshot({ path: path.join(outDir, 'home.png') });

  // right moves the track, down moves to the next row
  await press('ArrowRight');
  rows = await rowsInfo();
  assert.notEqual(rows[0].tx, 'translateX(0px)', 'ring row scrolled');
  await press('ArrowDown');
  rows = await rowsInfo();
  assert.ok(rows[1].active && !rows[0].active, 'second row active');
  const heroAfter = await page.evaluate(() => document.querySelector('[data-screen="home"] .hero-title').textContent);
  assert.ok(heroAfter.length > 0);
  await press('ArrowUp');

  // Enter opens a screen above home; Back returns with focus restored
  const before = await rowsInfo();
  await press('Enter');
  await page.waitForTimeout(300);
  const depth = await page.evaluate(() => document.querySelectorAll('.screen').length);
  assert.ok(depth >= 2, 'detail screen opened');
  assert.ok(await page.evaluate(() => document.querySelector('[data-screen="home"]').classList.contains('hidden')), 'home hidden');
  await press('Escape');
  await page.waitForTimeout(300);
  const after = await rowsInfo();
  assert.deepEqual(after.map((r) => [r.title, r.tx, r.active]), before.map((r) => [r.title, r.tx, r.active]), 'focus restored');

  // up to the nav, right x3 to Anime, Enter -> hub with anime rows
  await press('ArrowUp', 3);
  await press('ArrowRight', 3);
  await press('Enter');
  await page.waitForSelector('[data-screen="hub"][data-tab="anime"] .row .tile-img.in', { timeout: 8000 });
  await page.waitForTimeout(900);
  const anime = await page.evaluate(() => Array.from(document.querySelectorAll('[data-screen="hub"] .row-title')).map((e) => e.textContent));
  assert.ok(anime.length >= 3, 'anime rows: ' + anime.join(','));
  assert.ok(anime.includes('Trending now') && anime.includes('New this season'), 'anime titles: ' + anime.join(','));
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-screen="home"]').length), 0, 'tab switch replaced home');
  await page.screenshot({ path: path.join(outDir, 'anime.png') });

  // a movies hub exists too, and genre chips open the library
  await press('ArrowUp', 5);
  await press('ArrowLeft', 2);
  await press('Enter');
  await page.waitForSelector('[data-screen="hub"][data-tab="movies"] .row .tile-img.in', { timeout: 8000 });
  await press('ArrowDown', 8);
  await page.waitForTimeout(500);
  const chips = await page.evaluate(() => document.querySelectorAll('.chip-pill').length);
  assert.ok(chips > 0, 'genre chips rendered');
  await press('Enter');
  await page.waitForSelector('[data-screen="library"] .tile-img.in', { timeout: 8000 });
  const lib = await page.evaluate(() => ({ genre: document.querySelector('.lib-genre').textContent, count: document.querySelector('.lib-count').textContent }));
  assert.ok(lib.genre && /title/.test(lib.count), 'library header ' + JSON.stringify(lib));
  await press('ArrowDown');
  await page.screenshot({ path: path.join(outDir, 'library.png') });

  const onScreen = await page.evaluate(() => window.__errors || []);
  assert.deepEqual(onScreen, [], 'on-screen errors: ' + onScreen.join(' | '));
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  await ctx.close();
  console.log('browse: ok (' + path.basename(exe) + ')');
} catch (e) {
  failed = e;
}
await browser.close();
server.close();
if (failed) {
  console.error('browse: FAILED\n' + (failed.stack || failed));
  process.exit(1);
}
