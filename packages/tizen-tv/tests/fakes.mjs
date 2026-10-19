// Tiny test doubles.
export function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

// Counts writes so tests can assert no-op writes are skipped.
export function fakeEl() {
  const classes = new Set();
  const el = {
    writes: { text: 0, style: 0, cls: 0 },
    classList: {
      contains: (n) => classes.has(n),
      toggle: (n, on) => { el.writes.cls++; if (on) classes.add(n); else classes.delete(n); },
    },
  };
  let text = '';
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { el.writes.text++; text = v; } });
  el.style = new Proxy({}, { set(t, k, v) { el.writes.style++; t[k] = v; return true; } });
  return el;
}
