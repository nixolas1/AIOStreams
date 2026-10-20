// Small modal on the focus model of the screens: Left/Right pick, OK acts, Back cancels.
//   const dlg = createConfirm(); screen.el.appendChild(dlg.el);
//   dlg.open({title, sub, confirm: 'Remove', cancel: 'Cancel', onConfirm, onCancel});
//   screen.onKey: if (dlg.isOpen()) return dlg.onKey(action);
// Focus starts on the cancel button so a stray OK never confirms.
import { h, setText, toggleClass, show } from '../util/dom.js';

export function createConfirm() {
  const title = h('div', 'confirm-title');
  const sub = h('div', 'confirm-sub');
  const okBtn = h('div', 'btn');
  const noBtn = h('div', 'btn');
  const el = h('div', { class: 'confirm hidden', dataset: { dialog: 'confirm' } }, [
    h('div', 'confirm-box', [title, sub, h('div', 'confirm-btns', [okBtn, noBtn])]),
  ]);
  let opts = null;
  let onOk = false;

  function paint() {
    toggleClass(okBtn, 'focus', onOk);
    toggleClass(noBtn, 'focus', !onOk);
  }

  function close() {
    opts = null;
    el.classList.add('hidden');
  }

  return {
    el: el,
    isOpen: function () { return !!opts; },
    open: function (o) {
      opts = o;
      onOk = false;
      setText(title, o.title || '');
      setText(sub, o.sub || '');
      show(sub, !!o.sub);
      setText(okBtn, o.confirm || 'OK');
      setText(noBtn, o.cancel || 'Cancel');
      el.classList.remove('hidden');
      paint();
    },
    close: close,
    /** Consumes every key while open. */
    onKey: function (action) {
      if (!opts) return false;
      if (action === 'left') { onOk = true; paint(); return true; }
      if (action === 'right') { onOk = false; paint(); return true; }
      if (action === 'enter') {
        const o = opts;
        close();
        const fn = onOk ? o.onConfirm : o.onCancel;
        if (fn) fn();
        return true;
      }
      if (action === 'back') {
        const o = opts;
        close();
        if (o.onCancel) o.onCancel();
        return true;
      }
      return true;
    },
  };
}
