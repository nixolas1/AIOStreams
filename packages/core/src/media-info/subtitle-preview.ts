import { execFile } from 'node:child_process';
import { appConfig } from '../utils/index.js';
import { httpReader } from './readers.js';
import { withLoopbackUrl } from './loopback.js';

interface Packet {
  stream_index: number;
  pts_time?: string;
  duration_time?: string;
  data?: string;
}
interface Stream {
  index: number;
  codec_name?: string;
  tags?: { language?: string; title?: string };
}
export interface SubtitlePreviewTrack {
  index: number;
  lang: string;
  title: string;
  cues: { start: number; end: number; text: string }[];
}

/** Decode ffprobe's hex column only, never the printable ASCII column. */
export function packetText(data: string, codec: string): string {
  const hex = data
    .split('\n')
    .map((line) => {
      const row = /^[0-9a-f]+:\s(.*)$/i.exec(line)?.[1];
      return row ? row.split(/ {2,}/)[0].replace(/\s/g, '') : '';
    })
    .join('');
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return '';
  let bytes = Buffer.from(hex, 'hex');
  if (codec === 'mov_text') {
    if (bytes.length < 2) return '';
    bytes = bytes.subarray(2, 2 + bytes.readUInt16BE(0));
  } else if (!['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'text'].includes(codec))
    return '';
  let text = bytes.toString('utf8');
  // Matroska ASS packets: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text.
  if (codec === 'ass' || codec === 'ssa')
    text = text.split(',').slice(8).join(',');
  return text
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\\[Nnh]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, 500);
}

export function previewTracks(
  streams: Stream[],
  packets: Packet[]
): SubtitlePreviewTrack[] {
  return streams
    .sort((a, b) => a.index - b.index)
    .map((stream) => ({
      index: stream.index,
      lang: stream.tags?.language || '',
      title: stream.tags?.title || '',
      cues: packets
        .filter((p) => p.stream_index === stream.index)
        .flatMap((p) => {
          const start = Number(p.pts_time) * 1000;
          const duration = Number(p.duration_time) * 1000;
          const text = packetText(p.data || '', stream.codec_name || '');
          return text && Number.isFinite(start)
            ? [
                {
                  start,
                  end:
                    start +
                    (Number.isFinite(duration) ? Math.max(0, duration) : 0),
                  text,
                },
              ]
            : [];
        }),
    }));
}

let running = 0;
/** A bounded, seeked read of all subtitle tracks, without touching TV playback. */
export async function readSubtitlePreview(
  url: string,
  timeMs: number,
  headers?: Record<string, string>
): Promise<SubtitlePreviewTrack[]> {
  if (running >= 2) throw new Error('preview busy');
  running++;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12_000);
  try {
    const file = await httpReader(url, abort.signal, headers);
    return await withLoopbackUrl(
      file,
      (localUrl) =>
        new Promise((resolve, reject) => {
          const start = Math.max(0, timeMs / 1000 - 90);
          const end = timeMs / 1000 + 90;
          execFile(
            appConfig.mediaInfo.ffprobePath,
            [
              '-v',
              'error',
              '-print_format',
              'json',
              '-select_streams',
              's',
              '-read_intervals',
              `${start}%${end}`,
              '-show_packets',
              '-show_data',
              '-show_entries',
              'stream=index,codec_name:stream_tags=language,title:packet=stream_index,pts_time,duration_time,data',
              localUrl,
            ],
            {
              signal: abort.signal,
              timeout: 12_000,
              maxBuffer: 2 * 1024 * 1024,
            },
            (error, stdout) => {
              if (error) {
                reject(new Error('subtitle preview unavailable'));
                return;
              }
              try {
                const output = JSON.parse(stdout);
                resolve(
                  previewTracks(output.streams || [], output.packets || [])
                );
              } catch {
                reject(new Error('invalid subtitle preview'));
              }
            }
          );
        })
    );
  } finally {
    clearTimeout(timer);
    abort.abort();
    running--;
  }
}
