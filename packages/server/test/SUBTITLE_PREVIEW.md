# Local subtitle integration checks

Run against the compiled server image and the freshly built TV widget:

```sh
SUBTITLE_TEST_IMAGE=tv-aiostreams/server:subtitle-repair-173c90ab \
  packages/tizen-tv/tests/browser/run-packaged-subtitles.sh
```

Requires Docker, the local Playwright/Chromium installation used by browser smoke,
and free loopback port 8791. The runner creates a disposable container and fixture
directory and removes both on exit. It uses synthetic identity and memo lookup;
no user configuration, tokens, library or database is accessed.

The server test imports the actual compiled subtitle router, cache and extraction
code, and runs the image's ffprobe through real HTTP range requests. The browser
loads build/app (the bundle packaged into the WGT), navigates with key presses,
and forwards preview requests to that endpoint. AVPlay itself is simulated with
state validation because it cannot run in desktop Chromium. This proves app
ordering and DOM subtitle rendering, not native Samsung decoding.

The compressed synthetic MKV contains a black video and English/Norwegian ASS
tracks, with cues before and after 45 seconds. Zero padding to 17 MiB satisfies
the shared reader's minimum release size. It intentionally does not represent a
high-bitrate movie. The small-file test passes for 173c90ab.

## Known failing large-file case (2026-10-25)

A 150-second, 1.2 GiB synthetic noise video with the same subtitle tracks exhausts
the 96 MiB ranged-reader budget while scanning the 90-second lookbehind/ahead
window. The extraction may return earlier cues without the nearer upcoming cue.
The test asserts that the upcoming English cue is present and fails. Do not treat
the small-file pass as release clearance for embedded previews.

To reproduce, generate a synthetic high-bitrate MKV with FFmpeg (the English and
Norwegian SRT bodies are given below), then use:

```sh
ffmpeg -f lavfi -i 'nullsrc=size=1280x720:rate=5:duration=150,noise=alls=100:allf=t' \
  -i en.srt -i no.srt -map 0 -map 1 -map 2 -c:v mpeg2video -q:v 2 -c:s ass \
  -metadata:s:s:0 language=eng -metadata:s:s:1 language=nor high-bitrate.mkv
SUBTITLE_TEST_IMAGE=tv-aiostreams/server:subtitle-repair-173c90ab \
  SUBTITLE_TEST_FIXTURE=/absolute/path/high-bitrate.mkv \
  packages/tizen-tv/tests/browser/run-packaged-subtitles.sh
```

English fixture:

```srt
1
00:00:05,000 --> 00:00:08,000
Earlier English dialogue

2
00:01:10,000 --> 00:01:13,000
English ahead, with commas

3
00:02:10,000 --> 00:02:13,000
Later English dialogue
```

Norwegian fixture:

```srt
1
00:00:04,000 --> 00:00:07,000
Tidligere norsk tekst

2
00:01:12,000 --> 00:01:15,000
Norsk tekst fremover
```
