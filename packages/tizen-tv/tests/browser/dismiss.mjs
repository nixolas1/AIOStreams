#!/usr/bin/env node
// Browser test for search-on-OK and long-press dismiss (Continue watching / Next up, detail buttons)
// against the mock server. Writes out/screens/{search-searching,dismiss-confirm}.png. Skips (exit 0)
// when no Playwright or Chromium can be found.
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
  console.log('dismiss: SKIPPED (' + why + ')');
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
  const hold = async (k, ms) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(150); };
  const text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
  const texts = (sel) => page.evaluate((s) => Array.prototype.map.call(document.querySelectorAll(s), (e) => e.textContent), sel);
  const home = '[data-screen="home"]:not(.hidden)';
  const rowTitles = () => texts(home + ' .row-title');
  const visibleTiles = (title) => page.evaluate(([h, t]) => {
    const row = Array.prototype.find.call(document.querySelectorAll(h + ' .row'), (r) => r.querySelector('.row-title').textContent === t);
    return row ? Array.prototype.filter.call(row.querySelectorAll('.tile'), (x) => x.style.visibility !== 'hidden' && x.querySelector('.tile-cap, .tile-ph, .tile-frame')).length : -1;
  }, [home, title]);
  const settle = (ms) => page.waitForTimeout(ms || 400);
  const toastText = () => page.evaluate(() => { const t = document.querySelector('.toast'); return t && t.classList.contains('on') ? t.textContent : ''; });

  // ---------- 1. search: OK only ----------
  await page.goto(origin + '/');
  await page.waitForSelector(home + ' .row .tile-img.in', { timeout: 8000 });
  await page.evaluate(async () => { (await import('/js/nav.js')).go('openSearch'); });
  await page.waitForSelector('[data-screen="search"]:not(.hidden)');
  const emptyTitle = () => text('[data-screen="search"] .search-empty-title');
  const emptySub = () => text('[data-screen="search"] .search-empty-sub');
  const submit = async (term) => {
    await press('Enter'); // start editing (focus is on the box)
    await page.fill('[data-screen="search"] .field-input', term);
    await page.keyboard.press('Enter');
  };
  const toInput = async () => {
    for (let i = 0; i < 3 && !(await page.$('[data-screen="search"] .field-box.focus')); i++) await press('ArrowUp');
    assert.ok(await page.$('[data-screen="search"] .field-box.focus'), 'focus is on the search box');
  };
  const rowCount = async () => (await page.$$('[data-screen="search"] .row-title')).length;

  // a slow search shows a clear "Searching" state and clears old rows
  server.knobs.searchDelayMs = 800;
  await submit('wonder');
  await page.waitForFunction(() => /Searching for/.test((document.querySelector('[data-screen="search"] .search-empty-title') || {}).textContent || ''), null, { timeout: 2000 });
  assert.equal(await emptyTitle(), 'Searching for "wonder"…');
  assert.equal(await rowCount(), 0);
  await page.screenshot({ path: path.join(shots, 'search-searching.png') });
  await page.waitForFunction(() => document.querySelector('[data-screen="search"] .row-title') || /No results/.test(document.querySelector('[data-screen="search"] .search-empty-title').textContent), null, { timeout: 5000 });
  assert.equal(server.searchLog.length, 1);
  assert.equal(server.searchLog[0].term, 'wonder');

  // a failing search says so; re-committing the same term retries and succeeds
  server.knobs.searchDelayMs = 0;
  server.knobs.searchStatus = 500;
  await toInput();
  await submit('wonder');
  await page.waitForFunction(() => /Search failed/.test(document.querySelector('[data-screen="search"] .search-empty-title').textContent), null, { timeout: 3000 });
  assert.equal(await rowCount(), 0, 'rows cleared on failure');
  server.knobs.searchStatus = 0;
  await toInput();
  await submit('wonder');
  await page.waitForFunction(() => document.querySelector('[data-screen="search"] .row-title') || /No results/.test(document.querySelector('[data-screen="search"] .search-empty-title').textContent), null, { timeout: 3000 });
  assert.equal(server.searchLog.length, 3, 'one request per commit');
  assert.ok(server.searchLog.every((r) => r.path === '/Items' && r.term === 'wonder'), JSON.stringify(server.searchLog));

  // a recent chip searches once too
  await toInput();
  await press('ArrowDown');
  assert.ok(await page.$('[data-screen="search"] .search-chip.focus'), 'chip focused');
  await press('Enter');
  await page.waitForTimeout(800);
  assert.equal(server.searchLog.length, 4);
  await press('Escape'); // back to home

  // ---------- 2. long press ----------
  await page.waitForSelector(home + ' .row .tile-img.in');
  await page.waitForTimeout(600);
  const screens = () => page.evaluate(() => document.querySelectorAll('.screen').length);
  const dialog = () => page.evaluate(() => { const d = document.querySelector('[data-dialog="confirm"]:not(.hidden)'); return d ? d.querySelector('.confirm-title').textContent : ''; });
  const activeRow = () => page.evaluate((h) => { const r = document.querySelector(h + ' .row.active .row-title'); return r ? r.textContent : ''; }, home);
  const goToRow = async (title) => { for (let i = 0; i < 10 && (await activeRow()) !== title; i++) await press('ArrowDown'); assert.equal(await activeRow(), title); };

  assert.equal(await activeRow(), 'Continue watching');
  assert.deepEqual(await rowTitles().then((t) => t.slice(0, 2)), ['Continue watching', 'Next up']);
  assert.equal(await visibleTiles('Continue watching'), 3);
  const before = await screens();

  // cancel (default focus) sends nothing and the release opens nothing
  await hold('Enter', 800);
  assert.equal(await dialog(), 'Remove from Continue watching?');
  await page.screenshot({ path: path.join(shots, 'dismiss-confirm.png') });
  await press('Enter'); // Cancel
  assert.equal(await dialog(), '');
  assert.equal(server.userLog.length, 0);
  assert.equal(await screens(), before, 'long press did not open the item');

  // a failing request keeps the tile and says so
  server.knobs.userStatus = 500;
  await hold('Enter', 800);
  await press('ArrowLeft');
  await press('Enter'); // Remove
  await page.waitForFunction(() => /Couldn't remove/.test((document.querySelector('.toast.on') || {}).textContent || ''), null, { timeout: 3000 });
  assert.equal(await visibleTiles('Continue watching'), 3);
  server.knobs.userStatus = 0;
  server.userLog.length = 0;

  // a short press still opens the item (on release), Back returns
  await press('Enter');
  await page.waitForSelector('[data-screen="detail"]:not(.hidden) .detail-btn');
  assert.equal(await screens(), before + 1);
  await settle(300);

  // detail: a resume item offers "Remove from Continue watching"; no Next up button without the hint
  await page.waitForFunction(() => document.querySelector('.detail:not(.hidden) .detail-meta').textContent.length > 0);
  let labels = await texts('.detail:not(.hidden) .detail-btn');
  assert.ok(labels.includes('Remove from Continue watching'), 'resume button: ' + labels);
  assert.ok(!labels.includes('Remove from Next up'), 'no next up button: ' + labels);
  const at = labels.indexOf('Remove from Continue watching');
  await press('ArrowRight', at);
  assert.equal(await text('.detail:not(.hidden) .detail-btn.focus'), 'Remove from Continue watching');
  await page.screenshot({ path: path.join(shots, 'dismiss-detail.png') });
  await press('Enter');
  await page.waitForFunction(() => /Removed from Continue watching/.test((document.querySelector('.toast.on') || {}).textContent || ''), null, { timeout: 3000 });
  labels = await texts('.detail:not(.hidden) .detail-btn');
  assert.ok(!labels.includes('Remove from Continue watching'), 'button hidden after: ' + labels);
  assert.equal(server.userLog.length, 1);
  assert.deepEqual(server.userLog[0].body, { PlaybackPositionTicks: 0 });
  await press('Escape');
  await page.waitForTimeout(300);
  // home refetches the invalidated row
  await page.waitForFunction((h) => {
    const rows = Array.prototype.slice.call(document.querySelectorAll(h + ' .row'));
    const r = rows.filter((x) => x.querySelector('.row-title').textContent === 'Continue watching')[0];
    return r && Array.prototype.filter.call(r.querySelectorAll('.tile'), (t) => t.style.visibility !== 'hidden').length === 2;
  }, home, { timeout: 5000 });

  // detail opened from Next up offers "Remove from Next up"
  await page.evaluate(async () => {
    const nav = await import('/js/nav.js');
    const jf = await import('/js/api/jellyfin.js');
    const r = await jf.nextUp({ limit: 5 });
    nav.go('openItem', r.Items[0], { from: 'nextup' });
  });
  await page.waitForSelector('[data-screen="detail"]:not(.hidden) .detail-btn');
  await page.waitForFunction(() => document.querySelector('.detail:not(.hidden) .detail-meta').textContent.length > 0);
  labels = await texts('.detail:not(.hidden) .detail-btn');
  assert.ok(labels.includes('Remove from Next up'), 'next up button: ' + labels);
  await press('ArrowRight', labels.indexOf('Remove from Next up'));
  await press('Enter');
  await page.waitForFunction(() => /Removed from Next up/.test((document.querySelector('.toast.on') || {}).textContent || ''), null, { timeout: 3000 });
  assert.ok(!(await texts('.detail:not(.hidden) .detail-btn')).includes('Remove from Next up'));
  const drop = server.userLog[server.userLog.length - 1];
  assert.ok(drop.method === 'POST' && /\/Rating$/.test(drop.path) && drop.query.likes === 'false', JSON.stringify(drop));
  await press('Escape');
  await page.waitForFunction((h) => {
    const rows = Array.prototype.slice.call(document.querySelectorAll(h + ' .row'));
    const r = rows.filter((x) => x.querySelector('.row-title').textContent === 'Next up')[0];
    return r && Array.prototype.filter.call(r.querySelectorAll('.tile'), (t) => t.style.visibility !== 'hidden').length === 2;
  }, home, { timeout: 5000 });

  // long press Remove on Continue watching: tile leaves the row in place, toast, request sent
  await page.waitForTimeout(300);
  server.userLog.length = 0;
  await goToRow('Continue watching');
  await hold('Enter', 800);
  await press('ArrowLeft');
  await press('Enter');
  await page.waitForFunction(() => /Removed from Continue watching/.test((document.querySelector('.toast.on') || {}).textContent || ''), null, { timeout: 3000 });
  assert.equal(await visibleTiles('Continue watching'), 1);
  assert.equal(server.userLog.length, 1);
  assert.deepEqual(server.userLog[0].body, { PlaybackPositionTicks: 0 });

  // long press Remove on Next up drops the series
  await goToRow('Next up');
  await hold('Enter', 800);
  assert.ok(/^Remove .+ from Next up\?$/.test(await dialog()), await dialog());
  await press('ArrowLeft');
  await press('Enter');
  await page.waitForFunction(() => /Removed from Next up/.test((document.querySelector('.toast.on') || {}).textContent || ''), null, { timeout: 3000 });
  assert.equal(await visibleTiles('Next up'), 1);
  const d2 = server.userLog[server.userLog.length - 1];
  assert.ok(/\/UserItems\/[^/]+\/Rating$/.test(d2.path) && d2.query.likes === 'false', JSON.stringify(d2));

  // long press elsewhere behaves as OK: opens the item
  const shownBefore = await screens();
  await goToRow(await page.evaluate((h) => { const t = Array.prototype.map.call(document.querySelectorAll(h + ' .row-title'), (e) => e.textContent); return t.filter((x) => x !== 'Continue watching' && x !== 'Next up')[0]; }, home));
  await hold('Enter', 800);
  await page.waitForSelector('[data-screen="detail"]:not(.hidden)');
  assert.equal(await screens(), shownBefore + 1);
  assert.equal(await dialog(), '');
  await press('Escape');

  assert.deepEqual(await page.evaluate(() => window.__errors || []), [], 'no on-screen errors');
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  await ctx.close();
  console.log('dismiss: ok (' + path.basename(exe) + ')');
} catch (e) {
  failed = e;
}
await browser.close();
server.close();
if (failed) {
  console.error('dismiss: FAILED\n' + (failed.stack || failed));
  process.exit(1);
}
