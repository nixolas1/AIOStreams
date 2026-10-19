// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Text entry on the Tizen IME with a real <input>. The field has two states:
//  - focused (visual only): cream highlight and the hint "Press OK to type";
//  - editing: the <input> has DOM focus and the IME is up. While it does,
//    input.js only forwards back / up / down / enter / imedone / imecancel
//    to screens, everything else types.
// Screens call field.handleKey(action) first; it returns true when it consumed
// the key (so the screen must not also act on it).
import { h, toggleClass, show } from '../util/dom.js';

/**
 * @param {{placeholder?:string, value?:string, type?:string, label?:string,
 *          onInput?:(v:string)=>void, onDone?:(v:string)=>void, onCancel?:()=>void}} o
 */
export function createField(o) {
  o = o || {};
  const input = h('input', {
    class: 'field-input', type: o.type || 'text', placeholder: o.placeholder || '',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', autocorrect: 'off',
  });
  input.value = o.value || '';
  const hint = h('div', 'field-hint', 'Press OK to type');
  const el = h('div', 'field', [
    o.label ? h('div', 'field-label', o.label) : null,
    h('div', 'field-box', [input, hint]),
  ]);
  const box = el.lastChild;
  let editing = false;
  let focused = false;
  let before = input.value;

  function paint() {
    toggleClass(box, 'focus', focused);
    toggleClass(box, 'editing', editing);
    show(hint, focused && !editing);
  }

  function begin() {
    if (editing) return;
    editing = true;
    before = input.value;
    paint();
    try { input.focus(); } catch (e) { /* ignore */ }
  }
  function end(commit) {
    if (!editing) return;
    editing = false;
    try { input.blur(); } catch (e) { /* ignore */ }
    if (!commit) input.value = before;
    paint();
    if (commit) { if (o.onDone) o.onDone(input.value); } else if (o.onCancel) o.onCancel();
  }

  input.addEventListener('input', function () { if (o.onInput) o.onInput(input.value); });
  // The IME can also close itself (e.g. the remote's Return key): drop the editing state.
  input.addEventListener('blur', function () {
    if (editing) { editing = false; paint(); }
  });

  paint();

  return {
    el: el,
    input: input,
    value: function () { return input.value; },
    setValue: function (v) { input.value = v == null ? '' : String(v); },
    isEditing: function () { return editing; },
    // Visual focus of the field within its screen's zones.
    setFocused: function (on) {
      focused = !!on;
      if (!focused && editing) end(true);
      paint();
    },
    focused: function () { return focused; },
    begin: begin,
    commit: function () { end(true); },
    cancel: function () { end(false); },
    // Returns true if the key was consumed by the field.
    handleKey: function (action) {
      if (editing) {
        if (action === 'enter' || action === 'imedone') { end(true); return true; }
        if (action === 'back' || action === 'imecancel') { end(false); return true; }
        if (action === 'down' || action === 'up') { end(true); return false; } // commit, let the screen move
        return true;
      }
      if (focused && action === 'enter') { begin(); return true; }
      return false;
    },
  };
}
