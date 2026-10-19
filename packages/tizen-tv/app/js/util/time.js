export function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Trailing-edge debounce. The returned function has .cancel().
export function debounce(fn, ms) {
  let t = 0;
  function wrapped() {
    const args = arguments;
    const self = this;
    clearTimeout(t);
    t = setTimeout(function () { t = 0; fn.apply(self, args); }, ms);
  }
  wrapped.cancel = function () { clearTimeout(t); t = 0; };
  return wrapped;
}
