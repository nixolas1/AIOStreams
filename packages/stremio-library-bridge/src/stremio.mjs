export class AuthError extends Error {
  name = 'AuthError';
}
export class UpstreamError extends Error {
  name = 'UpstreamError';
}

// Stremio signals a dead session in the error body, not always the status.
const AUTH_CODES = new Set([1, 2]);
const AUTH_MESSAGE = /session|auth|token|logged/i;

export async function fetchLibrary({
  apiBase,
  authKey,
  timeoutMs = 15_000,
  fetchImpl = fetch,
}) {
  let res;
  try {
    res = await fetchImpl(`${apiBase.replace(/\/+$/, '')}/datastoreGet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authKey,
        collection: 'libraryItem',
        ids: [],
        all: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Message only: a fetch error can carry the request body.
    throw new UpstreamError(`request failed: ${err?.name ?? 'error'}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`stremio rejected the auth key (HTTP ${res.status})`);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamError(`unreadable response (HTTP ${res.status})`);
  }

  if (body?.error) {
    const { code, message } = body.error;
    if (AUTH_CODES.has(code) || AUTH_MESSAGE.test(String(message ?? ''))) {
      throw new AuthError('stremio rejected the auth key');
    }
    throw new UpstreamError(`stremio error ${code ?? ''}`.trim());
  }
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`);
  if (!Array.isArray(body?.result)) {
    throw new UpstreamError('response had no library');
  }
  return body.result;
}
