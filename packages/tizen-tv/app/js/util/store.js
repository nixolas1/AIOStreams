// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// localStorage JSON wrapper. Keys are prefixed; every access can throw
// (quota, private mode), so everything is guarded.
const PREFIX = 'atv.';

export function get(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function set(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function remove(key) {
  set(key, undefined);
}
