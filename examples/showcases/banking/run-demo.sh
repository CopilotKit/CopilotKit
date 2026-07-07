#!/usr/bin/env bash
# ============================================================================
# run-demo.sh — one-command cold start for the banking demo (self-hosted mode).
#
#   cd examples/showcases/banking && ./run-demo.sh
#
# Brings up the memory-enabled Intelligence stack + a working embedder, mints a
# dev license if needed, then starts the Next.js dev server. Idempotent: safe to
# re-run — it reuses anything already up.
#
# Embedder platform split (this is the whole point of the script):
#   - Apple Silicon (arm64): the bundled docker `tei` image is amd64-only and
#     crash-loops under emulation (Candle backend unavailable -> ONNX/ORT ->
#     404). So we run a NATIVE Metal TEI on the host (:7067) and point app-api
#     at it. Same TEI version + model => byte-identical embeddings, ~20x faster.
#   - amd64 / Linux / CI: use the bundled docker `tei` via its `cpu-fallback`
#     compose profile (native there, no emulation).
#
# Managed Intelligence users: you do NOT need this script — set the
# INTELLIGENCE_* endpoints + a CopilotKit-issued COPILOTKIT_LICENSE_TOKEN in
# .env and run `pnpm dev` directly. This script is the self-hosted local path.
# ============================================================================
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEMO_DIR"
LOG_DIR="${TMPDIR:-/tmp}/banking-demo"; mkdir -p "$LOG_DIR"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

wait_http() { # url label maxsecs
  local url="$1" label="$2" max="${3:-120}" i=0 code
  while [ "$i" -lt "$max" ]; do
    code="$(curl -s -m3 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    [ "$code" != "000" ] && { ok "$label ready ($code)"; return 0; }
    sleep 3; i=$((i+3))
  done
  die "$label did not come up at $url within ${max}s (see $LOG_DIR)"
}

# --- Preflight --------------------------------------------------------------
say "Preflight"
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop and re-run."
[ -f .env ] || die ".env missing. Copy .env.example to .env and set OPENAI_API_KEY."
grep -q '^OPENAI_API_KEY=.\+' .env || die "OPENAI_API_KEY not set in .env (the agent needs it)."
# The composite image build context + the dev-license signer both need the
# (private) Intelligence source. Default to the sibling checkout the compose uses.
export INTELLIGENCE_REPO="${INTELLIGENCE_REPO:-$(cd "$DEMO_DIR/../../../../Intelligence" 2>/dev/null && pwd || true)}"
[ -n "$INTELLIGENCE_REPO" ] && [ -d "$INTELLIGENCE_REPO" ] \
  || die "INTELLIGENCE_REPO not found. Point it at your Intelligence checkout (self-hosted mode needs the source to build the image + mint a dev license)."
ok "docker running, .env present, INTELLIGENCE_REPO=$INTELLIGENCE_REPO"

# --- Dev license ------------------------------------------------------------
# Self-hosted memory is gated behind a signed offline license. Mint one only if
# .env doesn't already carry a token, so re-runs don't churn the baked key.
if grep -q '^COPILOTKIT_LICENSE_TOKEN=.\+' .env; then
  ok "dev license already present in .env"
else
  say "Minting a dev license (features.memory=true) into .env"
  node scripts/mint-dev-license.mjs --write
fi

# --- Embedder + stack (platform split) --------------------------------------
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  say "Apple Silicon ($ARCH): native Metal TEI on :7067 (bundled amd64 tei is skipped)"
  if [ "$(curl -s -m3 -o /dev/null -w '%{http_code}' http://localhost:7067/health 2>/dev/null)" != "200" ]; then
    command -v text-embeddings-router >/dev/null 2>&1 \
      || die "native TEI missing. Install it:  brew install text-embeddings-inference"
    say "    starting native Metal TEI (Qwen/Qwen3-Embedding-0.6B)"
    # --max-batch-tokens caps the warmup forward pass. TEI's default (16384) can
    # fault the Metal backend during warmup on some Apple Silicon setups: the
    # process either deadlocks (all threads parked, 0% CPU) or dies silently
    # without a panic — a GPU-level abort — so :7067 never binds and the health
    # wait below times out. A small warmup batch clears warmup reliably. It only
    # bounds per-request tokens (memory texts are short), not the embedding
    # vectors themselves, so recall stays byte-identical.
    nohup text-embeddings-router --model-id 'Qwen/Qwen3-Embedding-0.6B' \
      --port 7067 --auto-truncate --max-batch-tokens 512 \
      > "$LOG_DIR/tei-metal.log" 2>&1 & disown
  fi
  wait_http "http://localhost:7067/health" "native Metal TEI" 300
  # Warm the model so the first real recall isn't a cold forward pass.
  curl -s -m30 -o /dev/null -X POST http://localhost:7067/embed \
    -H 'Content-Type: application/json' -d '{"inputs":"warmup"}' 2>/dev/null || true
  export MEMORY_EMBEDDINGS_URL="http://host.docker.internal:7067"
  say "Bringing up the stack (embedder = native host TEI; docker tei stays off)"
  docker compose up -d --wait
else
  say "amd64/Linux ($ARCH): bundled docker tei via the cpu-fallback profile"
  docker compose --profile cpu-fallback up -d --wait
fi
ok "stack healthy: app-api :7050, gateway :7053"

# --- App --------------------------------------------------------------------
say "Starting the Next.js dev server (http://localhost:3000)"
say "    (stack is up; Ctrl-C stops only the dev server, not the docker stack)"
exec pnpm dev
