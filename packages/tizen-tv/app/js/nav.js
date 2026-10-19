// Decoupling registry so screens can open each other without import cycles.
// app.js registers the real implementations; screens only call nav.go().
//   openItem(item) playItem(item, opts) openLibrary(view, opts) openHub(kind)
//   openSearch() openSettings() openSources(item) openConnect()
const table = {};

export function register(name, fn) {
  table[name] = fn;
}

export function go(name) {
  const fn = table[name];
  if (!fn) {
    if (typeof console !== 'undefined') console.warn('nav: no handler for', name);
    return undefined;
  }
  return fn.apply(null, Array.prototype.slice.call(arguments, 1));
}

export function has(name) {
  return !!table[name];
}
