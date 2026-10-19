# Working on AIOStreams TV (packages/tizen-tv)

- Chrome 76 only: run `npm run check` and `npm test` before handing work over. Banned JS and CSS are listed in
  README.md; `scripts/check-legacy.mjs` enforces them. No framework, no bundler, no npm runtime deps.
- Fixed 1920x1080 px layout. Animate only `transform` and `opacity`. Skip no-op DOM writes (`util/dom.js`).
- Never install to the TV without the owner's explicit approval for that install; a request to edit or commit is not
  approval. Use `./tvctl` from the workspace root. Never uninstall to fix errors.
- Never print, log or commit credentials, tokens, TV IPs/IDs, certificate data or configuration links. Do not touch the
  workspace `.env` or `aiostreams/data`. Fixtures are fully synthetic; keep them so.
- Adapted samsucks code (GPL-3.0) keeps its attribution header and a line in `NOTICE`.
- Module contracts and file ownership: `CONTRACTS.md`. Stay inside your owned files; the shared core is frozen.
- Real-server facts to remember: CollectionType is `movies|tvshows|boxsets` only; anime is recognised by view name.
- Hardware feedback (visuals, playback) is recorded separately from local browser checks.
