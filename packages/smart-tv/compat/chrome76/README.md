# Experimental Tizen 6 compatibility build

This directory preserves the release patches tested on a 2021 Samsung Frame
running Tizen 6 / Chromium 76. It rebuilds **smart-tv 0.3.1**, not the current
web app source. It is an opt-in fork experiment, not a claim of upstream support
for every older TV.

## Reproduce

Requires Python 3.10+, Node.js and npm. From this directory:

```sh
npm ci --ignore-scripts --workspaces=false
mkdir -p downloads
gh release download smart-tv-v0.3.1 --repo Viren070/AIOStreams \
  --pattern aiostreams-tizen-0.3.1.wgt \
  --output downloads/aiostreams-tizen.wgt
python3 scripts/build_aiostreams_compat.py
python3 -m unittest discover -s tests -p 'test_*.py'
```

The input must match SHA-256
`766f6de50e291ef800cce4e65f5374acab94cd3d7cb0b30ec4945ef824bc729c`.
The script refuses changed inputs or changed patch sites. Dependencies are
locked; ZIP timestamps are fixed. Current output SHA-256 is
`d3626d4d46b462cba8079ddee15175bc5049462f4fd5c2150b0be6ea4ea1a6b5`.

Output: `downloads/aiostreams-tizen-chrome76.wgt`. The widget is unsigned and
retains app ID `AIOStreams.aiostreams` and displayed version 0.3.1. Install in
place using the app's previously accepted signing certificates. Keep a known
working rollback; do not uninstall as a workaround for signing errors.

The browser fixtures use `CHROME_BIN` if set, otherwise a locally cached
Playwright macOS Chromium headless shell. They explicitly skip if neither is
available. No account, server, TV connection or credentials are needed for tests.

## What the patch changes

- Transforms JavaScript to Chrome 76 and adds core-js stable API polyfills.
- Replaces two unsupported `matches(':focus-visible')` calls that interrupted
  remote navigation, playback controls and initial source focus.
- Hides retained inactive Home content with `visibility`; Chrome 76 ignores
  `content-visibility`, otherwise painting catalogs over movie details.
- Gives poster, landscape and square artwork measurable height without
  `aspect-ratio`. The image loader waits for nonzero dimensions.
- Adds scoped flex-gap replacements and six ordinary safe-area padding
  fallbacks before unsupported `max()` declarations.
- Uses content-derived asset names to prevent stale assets on same-version
  updates.
- Adds visible yellow focus, opaque panels, and rounded focus borders/shadows.
- Skips the old-TV warning in this explicitly opt-in build. Startup error
  reporting is retained. This is not evidence that all TV features work.

## Validation and limits

Six JavaScript files parse as ES2019. Five regression checks cover the focus
helper, startup-error handling, asset references and unchanged playback chunks,
retained Home visibility/focus/scroll state, and artwork sizing/flex spacing.

The TV owner confirmed startup, playback, remote navigation/Back, first-source
focus, warning removal, Home thumbnails, spacing and readable movie details on
the prior square-focus build. The rounded-focus revision is locally checked but
has not yet been installed or visually confirmed on the TV. These browser
fixtures model missing features; they do not replace hardware validation.

The compact three-line source formatter in `examples/compact-tv-formatter.json`
is optional personal configuration, separate from the widget. Paste its `name`
and `description` into AIOStreams' custom formatter fields and save the existing
profile. Messages and long metadata can still wrap. It does not alter filtering
or sorting.

## Upstream follow-up

The general compatibility fixes are candidates for source-level changes in
`packages/web` and `packages/smart-tv`: feature detection for focus selectors,
inactive-route hiding, intrinsic artwork sizing, and an explicit legacy build
target. Port and test those independently before proposing broader supported-TV
claims. Personal focus colors, formatter preferences and warning suppression
should remain opt-in. No upstream PR is created by this archive.

Only source patches, dependency locks, templates and documentation are versioned.
Do not commit downloaded/signed widgets, certificates, API keys, server data,
installation links or device identifiers.
