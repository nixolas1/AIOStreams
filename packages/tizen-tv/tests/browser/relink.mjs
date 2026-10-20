#!/usr/bin/env node
// Re-link browser test: a handed-in PlaybackInfo whose stream link has expired (410) makes the player fetch a
// current list once and reopen the SAME version at the same resume position; if the fresh list fails too,
// it does not loop (relist once) and the existing fallback / error box appears.
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

  const text = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);
  // Whole-list requests (Fresh, no named version) from index n on; the player's background subtitle lookup names a version.
  const lists = (n) => server.infoLog.slice(n).filter((e) => e.fresh && !e.sourceId).length;
  const settle = (ms) => page.waitForTimeout(ms || 500);
  const expire = (always) => page.evaluate(async ([base, a]) => {
    await fetch(base + '/__mock/expire' + (a == null ? '' : '?always=' + a), { method: 'POST' });
  }, ['/mock/jellyfin', always == null ? null : always]);
  // Start playback the way Sources does: with a handed-in list (opts.info) and a resume position.
  const play = (id, startMs) => page.evaluate(async ([i, ms]) => {
    const nav = await import('/js/nav.js');
    const jf = await import('/js/api/jellyfin.js');
    const item = await jf.item(i);
    const info = await jf.playbackInfo(i, {});
    nav.go('playItem', item, { info, startMs: ms });
  }, [id, startMs]);
  const leave = async () => {
    for (let i = 0; i < 3 && (await page.$('[data-screen="player"]')); i++) { await page.keyboard.press('Escape'); await settle(300); }
    await page.waitForSelector('[data-screen="player"]', { state: 'detached', timeout: 4000 });
  };

  await page.goto(origin + '/');
  await page.waitForSelector('[data-screen="home"]', { timeout: 5000 });
  const ID = 'mov00a1b2c3';

  // ---------- sanity: no hook, no relist ----------
  await play(ID, 0);
  await page.waitForFunction(() => { const v = document.querySelector('.player video'); return v && v.currentTime > 0.3; }, null, { timeout: 8000 });
  assert.equal(lists(0), 1, 'only the handed-in list: no relist without a failure');
  await leave();

  // ---------- expired link: relist once, same version, same position ----------
  // A list handed in (like Sources does), then the hook expires it before playback starts.
  const stale = await page.evaluate(async (i) => {
    const jf = await import('/js/api/jellyfin.js');
    window.__stale = await jf.playbackInfo(i, {});
    return window.__stale.PlaySessionId;
  }, ID);
  await expire();
  server.streamLog.length = 0;
  const infos1 = server.infoLog.length;
  await page.evaluate(async ([i, ms]) => {
    const nav = await import('/js/nav.js');
    const jf = await import('/js/api/jellyfin.js');
    nav.go('playItem', await jf.item(i), { info: window.__stale, startMs: ms });
  }, [ID, 5000]);
  await page.waitForFunction(() => { const v = document.querySelector('.player video'); return v && v.currentTime > 5.3; }, null, { timeout: 10000 });
  assert.ok(await page.evaluate(() => document.querySelector('.player-error').classList.contains('hidden')), 'no error box');
  assert.equal(lists(infos1), 1, 'exactly one relist');
  const log = server.streamLog.slice();
  assert.equal(log[0].session, stale, 'first attempt used the stale list');
  const fresh = log[log.length - 1];
  assert.notEqual(fresh.session, stale, 'retry uses the new PlaySessionId');
  assert.equal(fresh.source, log[0].source, 'same MediaSourceId as the first attempt');
  assert.ok(await page.evaluate(() => document.querySelector('.player video').currentTime) >= 5, 'resume position kept');
  await leave();

  // ---------- fresh list fails too: no loop ----------
  await expire(1);
  server.streamLog.length = 0;
  const infos2 = server.infoLog.length;
  await play(ID, 5000);
  await page.waitForFunction(() => { const b = document.querySelector('.player-error'); return b && !b.classList.contains('hidden'); }, null, { timeout: 15000 });
  await settle(1500);
  assert.equal(lists(infos2), 2, 'handed-in list plus a single relist');
  await expire(0);
  await leave();

  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  await ctx.close();
  console.log('relink: ok (' + path.basename(exe) + ')');
} catch (e) {
  failed = e;
}
await browser.close();
server.close();
if (failed) {
  console.error('relink: FAILED\n' + (failed.stack || failed));
  process.exit(1);
}
