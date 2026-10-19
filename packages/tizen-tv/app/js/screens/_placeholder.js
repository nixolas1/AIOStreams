// Shared by the phase-1 stub screens. Real screens replace their own file and
// stop importing this.
import { h } from '../util/dom.js';

export function placeholder(name, args) {
  const el = h('div', { class: 'screen screen-' + name, dataset: { screen: name } }, [
    h('div', 'ph-title', name),
    h('div', 'ph-sub', 'placeholder screen (phase 1)'),
  ]);
  return {
    name: name,
    el: el,
    args: args,
    onKey: function () { return false; },
  };
}
