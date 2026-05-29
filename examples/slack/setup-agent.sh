#!/usr/bin/env bash
# Sets up the beautiful_chat agent under ./agent/ for local use as our AG-UI
# endpoint. Idempotent — safe to re-run.
#
# What it does:
#   - Creates a Python virtual env in agent/.venv (Python 3.12 via uv)
#   - Installs requirements.txt into that venv
#   - Runs `npm install` for the Next.js layer
#
# After this, start the agent with:
#   cd agent && source .venv/bin/activate && OPENAI_API_KEY=sk-... npm run dev

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$HERE/agent"

if [ ! -d "$AGENT_DIR" ]; then
  echo "[setup-agent] missing $AGENT_DIR — agent copy expected here"
  exit 1
fi

cd "$AGENT_DIR"

# --- Python -----------------------------------------------------------------
if ! command -v uv >/dev/null 2>&1; then
  echo "[setup-agent] uv not found. Install with:  curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

echo "[setup-agent] creating Python 3.12 venv at $AGENT_DIR/.venv"
uv venv --python 3.12 .venv >/dev/null

echo "[setup-agent] installing Python requirements"
# shellcheck disable=SC1091
source .venv/bin/activate
uv pip install -r requirements.txt

# --- Node -------------------------------------------------------------------
echo "[setup-agent] installing Node deps (npm install --legacy-peer-deps)"
# --legacy-peer-deps: cmdk@0.2.1 in the showcase pins react ^18 but the rest of
# the project pulls react 19. Showcase ships fine this way on Railway.
npm install --legacy-peer-deps --no-audit --no-fund

echo
echo "[setup-agent] done."
echo
echo "Next steps:"
echo "  cd $AGENT_DIR"
echo "  source .venv/bin/activate"
echo "  export OPENAI_API_KEY=sk-..."
echo "  npm run dev      # Next.js :3000 + langgraph :8123"
