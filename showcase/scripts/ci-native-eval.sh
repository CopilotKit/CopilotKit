#!/usr/bin/env bash
set -euo pipefail

# ci-native-eval.sh — Start showcase integrations natively (no Docker)
# for CI evaluation. Installs deps, starts dev servers + agents,
# waits for health, then runs showcase eval --ci.
#
# Usage: ci-native-eval.sh [--level d5] [--scope affected|all] [--parallel N]
#
# Environment:
#   SHOWCASE_ROOT — path to showcase/ directory (default: auto-detect)
#   AIMOCK_PORT   — port for aimock (default: 4010)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHOWCASE_ROOT="${SHOWCASE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SHARED_DIR="$SHOWCASE_ROOT/shared"
INTEGRATIONS_DIR="$SHOWCASE_ROOT/integrations"
LOCAL_PORTS="$SHARED_DIR/local-ports.json"

AIMOCK_PORT="${AIMOCK_PORT:-4010}"
LEVEL="d5"
SCOPE="affected"
PARALLEL="8"
PIDS=()

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --level) LEVEL="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --parallel) PARALLEL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

cleanup() {
  echo "[ci-native-eval] Tearing down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "[ci-native-eval] Cleanup complete."
}
trap cleanup EXIT

# ── 1. Start aimock ──────────────────────────────────────────────────
echo "[ci-native-eval] Starting aimock on :${AIMOCK_PORT}..."
npx aimock --port "$AIMOCK_PORT" &
PIDS+=($!)

for i in $(seq 1 30); do
  curl -sf "http://localhost:${AIMOCK_PORT}/health" >/dev/null 2>&1 && break || sleep 1
done
curl -sf "http://localhost:${AIMOCK_PORT}/health" >/dev/null 2>&1 || {
  echo "[ci-native-eval] ERROR: aimock did not become healthy" >&2
  exit 1
}
echo "[ci-native-eval] aimock healthy."

# ── 2. Read slug->port mapping ──────────────────────────────────────
SLUGS=$(node -e "console.log(Object.keys(require('$LOCAL_PORTS')).join(' '))")

# ── 3. Install deps + start services ────────────────────────────────
for slug in $SLUGS; do
  port=$(node -e "console.log(require('$LOCAL_PORTS')['$slug'])")
  agent_port=$((port + 100))
  slug_dir="$INTEGRATIONS_DIR/$slug"

  [ -d "$slug_dir" ] || continue
  echo "[ci-native-eval] Starting $slug (frontend :$port, agent :$agent_port)..."

  cd "$slug_dir"

  # Install Node deps
  if [ -f package.json ]; then
    pnpm install --ignore-scripts 2>/dev/null || npm install --legacy-peer-deps 2>/dev/null || true
  fi

  # Install Python deps + start agent
  if [ -f requirements.txt ]; then
    pip install -r requirements.txt --prefer-binary -q 2>/dev/null || true
    PYTHONPATH=. \
    OPENAI_BASE_URL="http://localhost:${AIMOCK_PORT}/v1" \
    OPENAI_API_KEY="aimock" \
      python -m uvicorn agent_server:app \
        --host 127.0.0.1 --port "$agent_port" \
        --log-level warning &
    PIDS+=($!)
  fi

  # Start Next.js dev server
  PORT="$port" \
  NEXT_PUBLIC_COPILOTKIT_URL="http://localhost:${agent_port}/api/copilotkit" \
    npx next dev --turbopack --port "$port" &
  PIDS+=($!)

  cd "$SHOWCASE_ROOT"
done

# ── 4. Health-wait ───────────────────────────────────────────────────
echo "[ci-native-eval] Waiting for services to become healthy..."
HEALTHY=0
TOTAL=0
for slug in $SLUGS; do
  port=$(node -e "console.log(require('$LOCAL_PORTS')['$slug'])")
  slug_dir="$INTEGRATIONS_DIR/$slug"
  [ -d "$slug_dir" ] || continue
  TOTAL=$((TOTAL + 1))

  ok=false
  for i in $(seq 1 120); do
    if curl -sf "http://localhost:$port" >/dev/null 2>&1; then
      ok=true
      break
    fi
    sleep 1
  done

  if $ok; then
    echo "[ci-native-eval]   + $slug :$port"
    HEALTHY=$((HEALTHY + 1))
  else
    echo "[ci-native-eval]   x $slug :$port (timeout)"
  fi
done
echo "[ci-native-eval] ${HEALTHY}/${TOTAL} services healthy."

# ── 5. Run eval ──────────────────────────────────────────────────────
echo "[ci-native-eval] Running showcase eval..."
"$SHOWCASE_ROOT/bin/showcase" eval \
  "--$LEVEL" \
  --scope "$SCOPE" \
  --parallel "$PARALLEL" \
  --json \
  --baseline compare \
  --timeout 60000 \
  --ci
