#!/usr/bin/env node
// Verifies a directory only uses what Chrome 76 (Tizen 6) can run:
//  - every .js/.mjs parses as an ES2019 module (acorn), which already rejects
//    ?. ?? ||= &&= ??= #private static-blocks top-level-await numeric-separators;
//  - token lint for post-Chrome-76 APIs (.at, replaceAll, ...);
//  - regex lint for banned CSS features.
// Usage: node scripts/check-legacy.mjs <dir> [<dir>...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadAcorn() {
  const candidates = [
    process.env.ACORN_PATH,
    path.join(here, '..', 'node_modules', 'acorn', 'dist', 'acorn.mjs'),
    path.join(here, '..', '..', '..', '..', '..', '.tools', 'aiostreams-compat', 'node_modules', 'acorn', 'dist', 'acorn.mjs'),
    '/Users/nixo/project/tv/.tools/aiostreams-compat/node_modules/acorn/dist/acorn.mjs',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return import(pathToFileURL(c).href);
  }
  try { return await import('acorn'); } catch (e) { /* fall through */ }
  throw new Error('acorn not found; set ACORN_PATH or npm i -D acorn');
}

// Method / member names newer than Chrome 76.
const BANNED_MEMBERS = new Set([
  'at', 'replaceAll', 'findLast', 'findLastIndex', 'toSorted', 'toReversed', 'toSpliced', 'with',
  'hasOwn', 'groupBy', 'any', 'timeout',
]);
// "any"/"timeout"/"with" are only banned on specific receivers (below).
const BANNED_QUALIFIED = { any: 'Promise', timeout: 'AbortSignal', with: null, hasOwn: 'Object', groupBy: null };
const BANNED_GLOBALS = new Set(['structuredClone', 'AggregateError']);

export async function lintJs(source, file) {
  const acorn = await loadAcorn();
  const errors = [];
  try {
    acorn.parse(source, { ecmaVersion: 2019, sourceType: 'module', allowHashBang: true });
  } catch (e) {
    errors.push(file + ': ' + e.message);
    return errors;
  }
  const toks = [];
  for (const t of acorn.tokenizer(source, { ecmaVersion: 2019, sourceType: 'module', allowHashBang: true })) toks.push(t);
  const lineOf = (pos) => source.slice(0, pos).split('\n').length;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type.label === 'name' && BANNED_GLOBALS.has(t.value)) {
      errors.push(`${file}:${lineOf(t.start)}: ${t.value} is newer than Chrome 76`);
    }
    if (t.type.label === '.' && toks[i + 1] && toks[i + 1].type.label === 'name') {
      const name = toks[i + 1].value;
      if (!BANNED_MEMBERS.has(name)) continue;
      const prev = toks[i - 1];
      const recv = prev && prev.type.label === 'name' ? prev.value : null;
      const next = toks[i + 2];
      const isCall = next && next.type.label === '(';
      if (name === 'any' || name === 'timeout' || name === 'hasOwn') {
        if (recv !== BANNED_QUALIFIED[name]) continue;
      } else if (name === 'with' || name === 'groupBy') {
        if (!isCall) continue;
      } else if (!isCall && name !== 'replaceAll') continue;
      errors.push(`${file}:${lineOf(t.start)}: .${name} is newer than Chrome 76`);
    }
  }
  return errors;
}

const CSS_RULES = [
  [/(^|[;{\s])(row-|column-|grid-)?gap\s*:/, 'gap (flex/grid gap unsupported)'],
  [/aspect-ratio\s*:/, 'aspect-ratio'],
  [/(^|[;{\s])inset(-[a-z]+)*\s*:/, 'inset'],
  [/:focus-visible/, ':focus-visible'],
  [/content-visibility/, 'content-visibility'],
  [/(^|[^\w-])(max|min|clamp)\(/, 'max()/min()/clamp()'],
  [/backdrop-filter/, 'backdrop-filter'],
  [/:(is|where|has)\(/, ':is()/:where()/:has()'],
  [/@container/, '@container'],
  [/transition[^;}]*box-shadow/, 'animated box-shadow'],
];

export function lintCss(source, file) {
  const errors = [];
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = stripped.split('\n');
  lines.forEach((line, i) => {
    for (const [re, label] of CSS_RULES) {
      if (re.test(line)) errors.push(`${file}:${i + 1}: banned CSS: ${label}`);
    }
  });
  return errors;
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'fonts') continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

export async function check(dir) {
  const errors = [];
  let n = 0;
  for (const f of walk(dir, [])) {
    const rel = path.relative(process.cwd(), f);
    if (/\.(m?js)$/.test(f)) { n++; errors.push(...(await lintJs(fs.readFileSync(f, 'utf8'), rel))); }
    else if (/\.css$/.test(f)) { n++; errors.push(...lintCss(fs.readFileSync(f, 'utf8'), rel)); }
  }
  return { errors, files: n };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: check-legacy.mjs <dir>...'); process.exit(2); }
  let bad = 0;
  let files = 0;
  for (const d of dirs) {
    const r = await check(d);
    files += r.files;
    for (const e of r.errors) console.error(e);
    bad += r.errors.length;
  }
  if (bad) { console.error(`check-legacy: ${bad} problem(s)`); process.exit(1); }
  console.log(`check-legacy: ok (${files} files)`);
}
