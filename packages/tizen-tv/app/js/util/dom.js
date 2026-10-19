// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Tiny DOM helpers. The setters skip the write when nothing changed: text and
// style writes are what invalidate paint on recycled nodes.

// h('div', 'cls' | {class, id, text, style, dataset, attrs...}, children?)
export function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (typeof attrs === 'string') {
    el.className = attrs;
  } else if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') for (const s in v) el.style[s] = v[s];
      else if (k === 'dataset') for (const d in v) el.dataset[d] = v[d];
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  if (children == null) return;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) append(el, children[i]);
  } else if (typeof children === 'object') {
    el.appendChild(children);
  } else {
    el.appendChild(document.createTextNode(String(children)));
  }
}

export function setText(el, value) {
  value = value == null ? '' : String(value);
  if (el._text !== value) {
    el._text = value;
    el.textContent = value;
  }
}

export function setTransform(el, value) {
  if (el._tf !== value) {
    el._tf = value;
    el.style.transform = value;
  }
}

export function setStyle(el, prop, value) {
  const cache = el._st || (el._st = {});
  if (cache[prop] !== value) {
    cache[prop] = value;
    el.style[prop] = value;
  }
}

export function show(el, visible) {
  const v = visible ? '' : 'none';
  if (el._disp !== v) {
    el._disp = v;
    el.style.display = v;
  }
}

export function toggleClass(el, name, on) {
  if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
}
