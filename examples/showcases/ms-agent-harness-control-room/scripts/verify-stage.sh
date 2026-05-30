#!/bin/bash
set -euo pipefail

example_root="$(cd "$(dirname "$0")" && pwd)/.."
cd "$example_root"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command '$1' was not found." >&2
    exit 1
  fi
}

require_command pnpm
require_command docker
require_command curl

echo "==> Building Next.js stage UI"
pnpm run build

echo "==> Building Harness agent image"
docker compose build agent

echo "==> Starting Harness agent"
docker compose up -d agent

echo "==> Waiting for /health"
for attempt in $(seq 1 60); do
  if curl -fsS http://localhost:8000/health >/tmp/control-room-health.json 2>/dev/null; then
    break
  fi
  if [ "$attempt" = "60" ]; then
    echo "ERROR: agent did not become healthy on http://localhost:8000/health." >&2
    docker compose logs --tail=80 agent >&2 || true
    exit 1
  fi
  sleep 1
done
cat /tmp/control-room-health.json
echo

echo "==> Checking /features"
features="$(curl -fsS http://localhost:8000/features)"
echo "$features"
printf '%s' "$features" | grep -q "TodoListProvider"
printf '%s' "$features" | grep -q "ToolApprovalAgent"
printf '%s' "$features" | grep -q "pnpm_run"

echo "==> Resetting seeded fixture"
reset_payload="$(curl -fsS -X POST http://localhost:8000/fixture/reset)"
echo "$reset_payload"
printf '%s' "$reset_payload" | grep -q '"reset":true'
printf '%s' "$reset_payload" | grep -q '"file_count":5'

echo "==> Stage smoke verification passed"
