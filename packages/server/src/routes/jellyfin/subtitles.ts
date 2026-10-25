import { Router, type Request, type Response } from 'express';
import {
  Cache,
  convertSubtitle,
  createLogger,
  externalSubtitleFor,
  readBodyCapped,
  readSubtitlePreview,
  type SubtitlePreviewTrack,
  subtitleExtensionOf,
  type SubtitleFormat,
} from '@aiostreams/core';
import { jfOptional, param, qs } from './context.js';
import { ensureMemo, locate, pickSource } from './playback.js';

const logger = createLogger('jellyfin');
const router: Router = Router({ mergeParams: true });

const bodyCache = Cache.getInstance<
  string,
  { body: string; contentType: string }
>('jellyfin-subtitle-body', 1000);
const BODY_TTL = 3600;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_CACHED_BYTES = 512 * 1024;

function formatOf(raw: string): SubtitleFormat {
  const f = raw.toLowerCase();
  if (f === 'js' || f === 'json') return 'json';
  if (f === 'srt' || f === 'subrip') return 'srt';
  if (f === 'ass' || f === 'ssa') return 'ass';
  return 'vtt';
}

async function fetchSubtitle(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return null;

    return (await readBodyCapped(res, MAX_BYTES)).toString('utf8');
  } catch (error) {
    logger.debug(
      { url, err: error instanceof Error ? error.message : String(error) },
      'subtitle fetch failed'
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function subtitleHandler(req: Request, res: Response) {
  const msid = param(req, 'mediaSourceId').replace(/-/g, '').toLowerCase();
  const loc = await locate(req, param(req, 'itemId'), {
    hintMsid: msid,
    bySession: true,
  });
  if (!loc) {
    res.status(404).end();
    return;
  }
  const memo = await ensureMemo(loc);
  if (!memo) {
    res.status(404).end();
    return;
  }
  const source = pickSource(memo, loc.requestedMsid);
  const track = source
    ? externalSubtitleFor(source, Number(param(req, 'index')))
    : undefined;
  if (!track) {
    res.status(404).end();
    return;
  }
  const to = formatOf(param(req, 'format'));
  const key = `${track.url}|${to}`;
  let converted = await bodyCache.get(key).catch(() => undefined);
  if (!converted) {
    const raw = await fetchSubtitle(track.url);
    if (raw === null) {
      res.status(502).end();
      return;
    }
    converted = convertSubtitle(raw, subtitleExtensionOf(track.url), to);
    if (Buffer.byteLength(converted.body, 'utf8') <= MAX_CACHED_BYTES) {
      void bodyCache.set(key, converted, BODY_TTL).catch(() => undefined);
    }
  }
  res.setHeader('Content-Type', converted.contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(converted.body);
}

router.get(
  [
    '/Videos/:itemId/:mediaSourceId/Subtitles/:index/Stream.:format',
    '/Videos/:itemId/:mediaSourceId/Subtitles/:index/:start/Stream.:format',
  ],
  jfOptional(subtitleHandler)
);

// Small process-local cache coalesces focus changes and never persists stream URLs.
const previews = new Map<
  string,
  { until: number; value: Promise<SubtitlePreviewTrack[]> }
>();
router.get(
  '/Videos/:itemId/:mediaSourceId/SubtitlePreview',
  jfOptional(async (req, res) => {
    const position = Number(qs(req, 'PositionMs'));
    if (!Number.isFinite(position) || position < 0 || position > 86400000) {
      res.status(400).end();
      return;
    }
    const loc = await locate(req, param(req, 'itemId'), {
      hintMsid: param(req, 'mediaSourceId'),
      bySession: true,
    });
    const memo = loc && (await ensureMemo(loc));
    const source = memo && pickSource(memo, loc?.requestedMsid);
    if (!loc || !source || source.notice || source.live) {
      res.status(404).end();
      return;
    }
    const bucket = Math.floor(position / 30000);
    const key = JSON.stringify([loc.ctx.uuid, source.msid, source.url, bucket]);
    let cached = previews.get(key);
    if (!cached || cached.until < Date.now()) {
      if (previews.size >= 12) previews.delete(previews.keys().next().value!);
      cached = {
        until: Date.now() + 120000,
        value: readSubtitlePreview(
          source.url,
          bucket * 30000 + 15000,
          source.requestHeaders
        ),
      };
      previews.set(key, cached);
    }
    try {
      const tracks = await cached.value;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ Tracks: tracks });
    } catch {
      previews.delete(key);
      res.status(503).json({ Message: 'Subtitle preview unavailable' });
    }
  })
);

export default router;
