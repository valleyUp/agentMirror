#!/usr/bin/env bash
set -euo pipefail
mirror_image="${1:-agent-mirror:20260911}"
client_image="${2:-$mirror_image}"
test_name="agent-mirror-test-$$"
cleanup() {
  docker rm -f "$test_name" >/dev/null 2>&1 || true
  docker network rm "$test_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker image inspect "$mirror_image" >/dev/null
docker image inspect "$client_image" >/dev/null
docker network create --internal "$test_name" >/dev/null
docker run -d --pull=never --name "$test_name" --network "$test_name" --network-alias mirror "$mirror_image" >/dev/null
ready=0
for ((i=0;i<60;i++)); do
  if docker exec "$test_name" node /app/runtime/healthcheck.mjs; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then docker logs "$test_name"; exit 1; fi
mkdir -p reports
client_options=()
client_entrypoint=(--entrypoint node)
client_command=(src/smoke.ts)
if [[ -n "${MIRROR_TEST_NPM_DIR:-}" ]]; then
  client_options+=(-v "$MIRROR_TEST_NPM_DIR:/opt/test-npm:ro" -e MIRROR_NPM_CLI=/opt/test-npm/bin/npm-cli.js)
fi
report_name="${MIRROR_REPORT_NAME:-smoke-linux-x64.json}"
if [[ ! "$report_name" =~ ^[a-zA-Z0-9._-]+\.json$ ]]; then echo 'Invalid report filename' >&2; exit 1; fi
docker run --rm --pull=never --network "$test_name" "${client_entrypoint[@]}" \
  -v "$PWD:/app:ro" -v "$PWD/reports:/reports" -w /app \
  -e MIRROR_URL=http://mirror:8080 -e MIRROR_NETWORK_ISOLATED=1 \
  -e MIRROR_REPORT="/reports/$report_name" "${client_options[@]}" \
  "$client_image" "${client_command[@]}"
