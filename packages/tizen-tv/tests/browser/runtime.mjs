import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function findPlaywright() {
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

export function findChromium() {
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

