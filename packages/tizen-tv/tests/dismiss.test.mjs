import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './fakes.mjs';

globalThis.localStorage = fakeStorage();
globalThis.document = {
  addEventListener() {}, activeElement: null,
  documentElement: { classList: { contains: () => false, toggle() {} } },
};
globalThis.window = globalThis.window || { addEventListener() {} };

const session = await import('../app/js/session.js');
const { createLongPress, LONG_MS } = await import('../app/js/util/longpress.js');
const { indexAfterRemove } = await import('../app/js/ui/row.js');
const search = await import('../app/js/screens/search.js');
const jf = await import('../app/js/api/jellyfin.js');
const hubs = await import('../app/js/api/hubs.js');
session.setBase('h:1');
session.signIn({ token: 'tok', userId: 'u', userName: 'N' });

// Run timers by hand: setTimeout is replaced for the long-press tests.
function withTimers(fn) {
  const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  const timers = new Map();
  let id = 0;
  globalThis.setTimeout = (f, ms) => { timers.set(++id, { f, ms }); return id; };
  globalThis.clearTimeout = (i) => { timers.delete(i); };
  try { fn({ timers, fireAll() { for (const [i, t] of Array.from(timers)) { timers.delete(i); t.f(); } } }); }
  finally { globalThis.setTimeout = real.set; globalThis.clearTimeout = real.clear; }
}

test('long press: a short press reports enter on release', () => {
  withTimers((t) => {
    const out = [];
    const lp = createLongPress((a) => out.push(a));
    assert.equal(lp.down(false), true);
    assert.deepEqual(out, []); // nothing on keydown
    assert.equal(t.timers.size, 1);
    assert.equal([...t.timers.values()][0].ms, LONG_MS);
    assert.equal(lp.up(), true);
    assert.deepEqual(out, ['enter']);
    assert.equal(t.timers.size, 0);
  });
});

test('long press: holding fires longenter once and swallows the release', () => {
  withTimers((t) => {
    const out = [];
    const lp = createLongPress((a) => out.push(a));
    lp.down(false);
    t.fireAll();
    assert.deepEqual(out, ['longenter']);
    assert.equal(lp.down(true), false); // auto-repeat
    t.fireAll();
    assert.equal(lp.up(), true);
    assert.deepEqual(out, ['longenter']); // no trailing enter
    assert.equal(lp.up(), false); // stray keyup
  });
});

test('long press: the keyup after a long press is swallowed (never a second enter)', () => {
  withTimers((t) => {
    const out = [];
    const lp = createLongPress((a) => out.push(a));
    lp.down(false);
    t.fireAll();
    assert.deepEqual(out, ['longenter']);
    assert.equal(lp.up(), true); // consumed, no 'enter'
    assert.deepEqual(out, ['longenter']);
    assert.equal(LONG_MS, 450);
  });
});

test('long press: auto-repeat keydowns do not restart the timer', () => {
  withTimers((t) => {
    const out = [];
    let now = 1000;
    const lp = createLongPress((a) => out.push(a), { now: () => now });
    lp.down(false);
    now += 100;
    assert.equal(lp.down(true), false);
    assert.equal(lp.down(false), false); // repeat without the flag, no keyup between
    assert.equal(t.timers.size, 1);
    // A lost keyup: a keydown long after the last one starts a fresh press.
    now += 5000;
    assert.equal(lp.down(false), true);
    lp.up();
    assert.deepEqual(out, ['enter']);
  });
});

test('long press: cancel drops the press without firing', () => {
  withTimers((t) => {
    const out = [];
    const lp = createLongPress((a) => out.push(a));
    lp.down(false);
    lp.cancel();
    assert.equal(t.timers.size, 0);
    assert.equal(lp.up(), false);
    assert.deepEqual(out, []);
  });
});

test('indexAfterRemove keeps focus on the nearest survivor', () => {
  assert.equal(indexAfterRemove(2, 0, 4), 2); // removed the focused tile: the next one slides in
  assert.equal(indexAfterRemove(3, 0, 3), 2); // removed the last: step back
  assert.equal(indexAfterRemove(3, 1, 5), 2); // one removed to the left
  assert.equal(indexAfterRemove(0, 0, 0), 0); // emptied
});

test('errorCopy words timeouts, unreachable servers and other failures', () => {
  const retry = 'Press OK on the search box to try again.';
  assert.deepEqual(search.errorCopy({ status: 0, message: 'Timed out' }), { title: 'Search timed out', sub: retry });
  assert.deepEqual(search.errorCopy({ status: 0, message: "Can't reach the server" }), { title: 'Could not reach the server', sub: retry });
  assert.equal(search.errorCopy({ status: 500, message: 'HTTP 500' }).title, 'Search failed');
  assert.equal(search.errorCopy(new Error('x')).title, 'Search failed');
});

test('dismiss api shapes', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body });
    return { ok: true, status: 204, text: async () => '' };
  };
  await jf.clearResume('ep1');
  await jf.dropSeries('ser1');
  await jf.undropSeries('ser1');
  assert.deepEqual(seen.map((s) => [s.method, new URL(s.url).pathname, new URL(s.url).search, s.body]), [
    ['POST', '/jellyfin/UserItems/ep1/UserData', '?userId=u', '{"PlaybackPositionTicks":0}'],
    ['POST', '/jellyfin/UserItems/ser1/Rating', '?userId=u&Likes=false', undefined],
    ['DELETE', '/jellyfin/UserItems/ser1/Rating', '?userId=u', undefined],
  ]);
});

test('hubs.invalidate stamps the key', () => {
  assert.equal(hubs.invalidatedAt('resume'), 0);
  hubs.invalidate('resume');
  assert.ok(hubs.invalidatedAt('resume') > 0);
  assert.equal(hubs.invalidatedAt('nextup'), 0);
});
