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
  assert.equal(api.views.length, 6);
  assert.ok(api.views.includes('Trending Movies:movies') && api.views.includes('Anime Kitsu Trending:tvshows'));
  assert.equal(api.firstCount, 5);
  assert.equal(api.total, 20);
  assert.equal(api.sources, 3);
  assert.equal(api.firstAuth, false);
  assert.equal(api.thirdAuth, true);
  assert.ok(api.token && api.imgOk);
  assert.equal(api.resume, 3);
  assert.equal(api.me, 'Demo');

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
