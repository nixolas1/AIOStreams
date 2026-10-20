#!/usr/bin/env node
// Browser test for Connect / Search / Settings against the mock server. Writes
// out/screens/{connect-server,connect-code,search,settings}.png. Skips (exit 0)
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
  console.log('forms: SKIPPED (' + why + ')');
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

const browser = await pw.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
let failed = null;
try {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const settle = (ms) => page.waitForTimeout(ms || 400);

  // 1. Connect: server step.
  await page.goto(origin + '/');
  await page.waitForSelector('[data-screen="connect"] .field-box.focus');
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 3000 });
  await page.keyboard.press('Enter'); // start editing
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'INPUT'), 'input has focus');
  await page.keyboard.type('/mock/jellyfin');
  await settle(200);
  await page.screenshot({ path: path.join(shots, 'connect-server.png') });

  // 2. Done -> validate -> Quick Connect code (mock auto-approves after 2 polls).
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /^\d{6}$/.test((document.querySelector('.conn-code') || {}).textContent || ''), null, { timeout: 5000 });
  assert.equal(await page.textContent('.conn-code'), '482913');
  assert.ok(await page.evaluate(() => document.querySelector('.conn-qr').width > 100), 'qr drawn');
  await settle(300);
  await page.screenshot({ path: path.join(shots, 'connect-code.png') });
  await page.waitForSelector('[data-screen="home"]', { timeout: 15000 });
  const sess = await page.evaluate(() => JSON.parse(localStorage.getItem('atv.session') || '{}'));
  assert.ok(sess.token && sess.base.endsWith('/mock/jellyfin'), 'signed in and server stored');

  // 3. Search.
  await page.evaluate(async () => { (await import('/js/nav.js')).go('openSearch'); });
  await page.waitForSelector('[data-screen="search"]:not(.hidden)');
  await page.keyboard.press('Enter');
  await page.keyboard.type('the');
  // Typing alone never searches: no request, no hints, no result rows.
  await settle(900);
  assert.deepEqual(server.searchLog, [], 'no search while typing');
  assert.equal((await page.$$('[data-screen="search"] .row-title')).length, 0, 'no rows while typing');
  await page.keyboard.press('Enter'); // done: exactly one /Items search
  await page.waitForSelector('[data-screen="search"] .row-title', { timeout: 5000 });
  await settle(700);
  assert.equal(server.searchLog.length, 1, 'one request per search: ' + JSON.stringify(server.searchLog));
  assert.equal(server.searchLog[0].path, '/Items');
  const titles = await page.$$eval('[data-screen="search"] .row-title', (els) => els.map((e) => e.textContent));
  assert.ok(titles.includes('Movies') && titles.includes('Series'), 'rows: ' + titles.join(','));
  await page.screenshot({ path: path.join(shots, 'search.png') });
  await page.keyboard.press('Escape'); // back to home

  // 4. Settings: open, toggle a pref.
  await page.evaluate(async () => { (await import('/js/nav.js')).go('openSettings'); });
  await page.waitForSelector('[data-screen="settings"]:not(.hidden) .set-row');
  await settle(600);
  const rows = await page.$$eval('[data-screen="settings"] .set-label', (els) => els.map((e) => e.textContent));
  assert.ok(rows.includes('Prefer 4K') && rows.includes('Performance HUD'), 'settings rows: ' + rows.join(','));
  const target = rows.indexOf('Prefer 4K');
  for (let i = 0; i < target; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(60); }
  await page.keyboard.press('Enter');
  await settle(300);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('atv.pref4k'))), true);
  await page.keyboard.press('Enter');
  await settle(200);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('atv.pref4k'))), false);
  await page.screenshot({ path: path.join(shots, 'settings.png') });

  assert.equal(await page.evaluate(() => (window.__errors || []).length), 0, 'no on-screen errors');
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  await ctx.close();
  console.log('forms: ok (' + path.basename(exe) + ')');
} catch (e) {
  failed = e;
}
await browser.close();
server.close();
if (failed) {
  console.error('forms: FAILED\n' + (failed.stack || failed));
  process.exit(1);
}
