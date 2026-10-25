#!/bin/sh
set -eu
: "${SUBTITLE_TEST_IMAGE:?Set SUBTITLE_TEST_IMAGE to the locally built server image}"
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../../.." && pwd)
TEST_DIR=$(mktemp -d)
CONTAINER="tv-subtitle-test-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TEST_DIR"; }
trap cleanup EXIT INT TERM
if [ -n "${SUBTITLE_TEST_FIXTURE:-}" ]; then
  cp "$SUBTITLE_TEST_FIXTURE" "$TEST_DIR/test.mkv"
else
  gzip -dc "$ROOT/packages/server/test/fixtures/subtitle-preview.mkv.gz" > "$TEST_DIR/test.mkv"
fi
docker run -d --name "$CONTAINER" -p 127.0.0.1:8791:8791 \
  -e KEEP_TEST_SERVER=1 -e NODE_ENV=test -e LOG_LEVEL=error \
  -e SECRET_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
  -e BASE_URL=http://localhost:8791 \
  -v "$TEST_DIR:/fixtures:ro" -v "$ROOT/packages/server/test:/test:ro" \
  "$SUBTITLE_TEST_IMAGE" --experimental-test-module-mocks /test/subtitle-preview-integration.mjs >/dev/null
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker logs "$CONTAINER" 2>&1 | grep -q '^PASS:'; then break; fi
  if [ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" != true ]; then docker logs "$CONTAINER"; exit 1; fi
  sleep 1
done
docker logs "$CONTAINER"
docker logs "$CONTAINER" 2>&1 | grep -q '^PASS:'
node "$ROOT/packages/tizen-tv/tests/browser/packaged-subtitles.mjs"
