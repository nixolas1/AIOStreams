// Remember only URLs that an actual playback request has already resolved.
// Previews must never run the failover resolver or choose a different file.
const files = new Map<string, { url: string; until: number }>();
const TTL = 2 * 60 * 60 * 1000;
function key(value: string): string | undefined {
  try {
    const url = new URL(value, 'http://local.invalid');
    return url.pathname.includes('/debrid/playback/')
      ? url.pathname
      : undefined;
  } catch {
    return undefined;
  }
}
export function rememberPlayedFile(
  requestUrl: string,
  resolvedUrl: string
): void {
  const k = key(requestUrl);
  if (!k || !/^https?:\/\//i.test(resolvedUrl) || key(resolvedUrl)) return;
  if (files.size >= 100) files.delete(files.keys().next().value!);
  files.set(k, { url: resolvedUrl, until: Date.now() + TTL });
}
export function playedFileFor(sourceUrl: string): string | undefined {
  const k = key(sourceUrl);
  if (!k) return undefined;
  const hit = files.get(k);
  if (hit && hit.until > Date.now()) return hit.url;
  files.delete(k);
  return undefined;
}
