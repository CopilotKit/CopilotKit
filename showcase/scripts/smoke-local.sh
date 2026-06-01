#!/usr/bin/env bash
# End-to-end local smoke: bring up aimock + 17 showcase packages in Docker,
# wait for health, run the integration-smoke Playwright suite against localhost,
# print a pass/fail summary.
#
# Usage:
#   scripts/smoke-local.sh                # L1-L4 all levels
#   scripts/smoke-local.sh --level=L1     # single level (L1/L2/L3/L4)
#   scripts/smoke-local.sh --keep         # leave containers running after
#   scripts/smoke-local.sh --no-build     # assume images already built
#
# Prereqs: showcase/.env exists (copy from showcase/.env.example). Docker
# daemon running. `pnpm install` in showcase/tests has been run once.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(dirname "$HERE")"

LEVEL=""
KEEP=0
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --level=L1) LEVEL="@health" ;;
    --level=L2) LEVEL="@agent" ;;
    --level=L3) LEVEL="@chat" ;;
    --level=L4) LEVEL="@tools" ;;
    --keep) KEEP=1 ;;
    --no-build) NO_BUILD=1 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f "$SHOWCASE_DIR/.env" ]; then
  echo "[smoke-local] Missing showcase/.env. Copy .env.example and fill in keys." >&2
  exit 1
fi

if [ "$NO_BUILD" = "0" ]; then
  echo "[smoke-local] Building + starting 18 containers (aimock + 17 packages)..."
  "$HERE/dev-local.sh" up
else
  echo "[smoke-local] --no-build: assuming images present; starting containers..."
  docker compose -f "$SHOWCASE_DIR/docker-compose.local.yml" up -d
fi

echo "[smoke-local] Waiting 20s for containers to warm..."
sleep 20

GREP_ARG=("--grep" "${LEVEL:-@health|@agent|@chat|@tools}")
GREP_ARG+=("--grep-invert" "@starter")

cd "$SHOWCASE_DIR/tests"
EXIT=0
LOCAL_PORTS=1 SMOKE_ALL=true npx playwright test integration-smoke \
  "${GREP_ARG[@]}" --reporter=list || EXIT=$?

if [ "$KEEP" = "0" ]; then
  echo "[smoke-local] Tearing down..."
  "$HERE/dev-local.sh" down
else
  echo "[smoke-local] --keep: containers left running."
fi

exit "$EXIT"
