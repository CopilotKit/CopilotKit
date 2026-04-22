#!/bin/bash
# Run per-package e2e tests with aimock as the LLM backend.
#
# Usage:
#   ./showcase/scripts/run-e2e-with-aimock.sh <slug> [test-filter]
#
# Examples:
#   ./showcase/scripts/run-e2e-with-aimock.sh langgraph-python
#   ./showcase/scripts/run-e2e-with-aimock.sh agno agentic-chat
#
# This script:
#   1. Starts aimock with the feature-parity fixture
#   2. Starts the package dev server with OPENAI_BASE_URL pointing at aimock
#   3. Runs Playwright tests (optionally filtered)
#   4. Cleans up all background processes on exit

set -euo pipefail

SLUG=${1:?Usage: $0 <slug> [test-filter]}
FILTER=${2:-}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHOWCASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_DIR="$SHOWCASE_DIR/packages/$SLUG"

if [ ! -d "$PKG_DIR" ]; then
  echo "[e2e] ERROR: Package directory not found: $PKG_DIR" >&2
  exit 1
fi

cleanup() {
  echo "[e2e] Cleaning up..."
  [ -n "${AIMOCK_PID:-}" ] && kill "$AIMOCK_PID" 2>/dev/null || true
  [ -n "${DEV_PID:-}" ] && kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[e2e] Starting aimock with feature-parity fixture..."
npx aimock --fixtures "$SHOWCASE_DIR/aimock" --port 4010 --validate-on-load &
AIMOCK_PID=$!

# Wait for aimock to be ready
for i in $(seq 1 15); do
  if curl -sf http://localhost:4010/health > /dev/null 2>&1; then
    echo "[e2e] aimock is ready"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "[e2e] ERROR: aimock failed to start" >&2
    exit 1
  fi
  sleep 1
done

echo "[e2e] Starting $SLUG dev server..."
cd "$PKG_DIR"
OPENAI_BASE_URL=http://localhost:4010/v1 OPENAI_API_KEY=test-key pnpm dev &
DEV_PID=$!

# Wait for dev server
echo "[e2e] Waiting for dev server at http://localhost:3000..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000 > /dev/null 2>&1; then
    echo "[e2e] Dev server is ready"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[e2e] ERROR: Dev server failed to start" >&2
    exit 1
  fi
  sleep 2
done

echo "[e2e] Running Playwright tests..."
EXIT=0
npx playwright test $FILTER || EXIT=$?

echo "[e2e] Tests finished with exit code $EXIT"
exit $EXIT
