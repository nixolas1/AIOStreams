# Working on this compatibility fork

- Preserve the pinned release and input-hash checks. This folder patches a known
  released widget; it does not change the normal upstream build.
- Rebuild and run the regression checks described in README.md after changes.
- Use the workspace's `tvctl` CLI for installs, updates, status and launch when
  available. Prefer it over GUI installers and one-off SDK scripts.
- Ask the TV owner before **every** install/update or other TV interruption.
  A request to edit source or commit changes is not installation permission.
- Install in place with accepted certificates; do not uninstall to fix errors.
  The TV permits only one SDK client, so close competing installers first.
- Installation completion and app registry verification do not prove a visual
  fix. Record hardware feedback separately from local browser checks.
- Keep downloaded widgets, credentials, certificates, device identifiers and
  personal server configuration out of Git. Only the generic formatter template
  is intended for sharing.
