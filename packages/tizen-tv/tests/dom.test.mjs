import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeEl } from './fakes.mjs';
import { setText, setTransform, setStyle, show, toggleClass } from '../app/js/util/dom.js';

test('setText skips identical writes', () => {
  const el = fakeEl();
  setText(el, 'a'); setText(el, 'a'); setText(el, null); setText(el, '');
  assert.equal(el.writes.text, 2);
  assert.equal(el.textContent, '');
});

test('setTransform / setStyle / show skip no-ops', () => {
  const el = fakeEl();
  setTransform(el, 'translateX(1px)'); setTransform(el, 'translateX(1px)'); setTransform(el, 'translateX(2px)');
  setStyle(el, 'width', '10px'); setStyle(el, 'width', '10px'); setStyle(el, 'height', '10px');
  show(el, true); show(el, true); show(el, false); show(el, false);
  assert.equal(el.writes.style, 2 + 2 + 2);
  assert.equal(el.style.display, 'none');
});

test('toggleClass writes only on change', () => {
  const el = fakeEl();
  toggleClass(el, 'on', false);
  toggleClass(el, 'on', true); toggleClass(el, 'on', true);
  toggleClass(el, 'on', false);
  assert.equal(el.writes.cls, 2);
});
