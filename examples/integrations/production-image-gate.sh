#!/usr/bin/env bash
# Test-runner entrypoint for docker-compose.production-image.yml's `tests`
# service. Lives in a file rather than inline in the compose `command:`
# because Compose shell-word-splits a multi-line command string into argv,
# which silently mangles loops and `$(...)`.
set -euo pipefail

APP_URL="${STARTER_URL:-http://app:3000}"
MAX_ATTEMPTS="${GATE_WAIT_ATTEMPTS:-120}"

cd /tests
npm install --no-audit --no-fund
npx playwright install chromium

echo "[gate] waiting for the production image to serve ${APP_URL}/ ..."
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if node -e "require('http').get(process.argv[1], () => process.exit(0)).on('error', () => process.exit(1))" "$APP_URL/"; then
    echo "[gate] app responded after ${attempt} attempt(s)"
    break
  fi
  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "[gate] app never served a response after $((MAX_ATTEMPTS * 5))s" >&2
    exit 1
  fi
  sleep 5
done

exec npx playwright test starter-smoke --reporter=list
