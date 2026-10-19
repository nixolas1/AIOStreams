import test from 'node:test';
import assert from 'node:assert/strict';
import { lintJs, lintCss } from '../scripts/check-legacy.mjs';

const js = (s) => lintJs(s, 't.js');

test('accepts ES2019', async () => {
  assert.deepEqual(await js('export const a = async () => { for (const x of [1]) await x; };\nclass A { static s = 1; }'.replace('static s = 1;', '')), []);
});

for (const [name, src] of [
  ['optional chaining', 'const a = b?.c;'],
  ['nullish', 'const a = b ?? 1;'],
  ['logical assign', 'let a; a ||= 1;'],
  ['private field', 'class A { #x = 1; }'],
  ['numeric separator', 'const a = 1_000;'],
  ['top-level await', 'await Promise.resolve();'],
  ['.at()', 'const a = [].at(-1);'],
  ['replaceAll', 'const a = "x".replaceAll("a", "b");'],
  ['structuredClone', 'structuredClone({});'],
  ['Promise.any', 'Promise.any([]);'],
  ['randomUUID', 'crypto.randomUUID();'],
  ['replaceChildren', 'el.replaceChildren();'],
  ['WeakRef', 'new WeakRef({});'],
]) {
  test('rejects ' + name, async () => assert.ok((await js(src)).length > 0, src));
}

test('does not flag strings or comments', async () => {
  assert.deepEqual(await js('// a.at(1) replaceAll\nconst s = ".at(1) b?.c";'), []);
});

for (const css of ['a{gap:4px}', 'a{row-gap:4px}', 'a{aspect-ratio:1}', 'a{inset:0}', 'a:focus-visible{x:y}', 'a{content-visibility:auto}',
  'a{width:max(1px,2px)}', 'a{width:clamp(1px,2px,3px)}', 'a{backdrop-filter:blur(2px)}', 'a{transition:box-shadow 1s}',
  'a{mask-image:none}', 'a:not(.b,.c){x:y}', 'a{translate:1px}', 'a{color:rgb(1 2 3 / 50%)}']) {
  test('css rejects ' + css, () => assert.ok(lintCss(css, 't.css').length > 0));
}
test('css accepts min-width and comments', () => {
  assert.deepEqual(lintCss('/* gap: 1 */ a{min-width:1px;max-width:2px;margin-right:6px;-webkit-mask-image:none}', 't.css'), []);
});
