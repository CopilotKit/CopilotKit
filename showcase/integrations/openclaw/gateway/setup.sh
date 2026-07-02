#!/bin/bash
# Headless, no-prompt OpenClaw config for the showcase container. Runs at
# container start (needs runtime secrets: OPENAI_API_KEY, optional OPENAI_BASE_URL).
# No interactive installer, no device pairing — the frontend uses clawg-ui's
# operator-auth route with the baked OPENCLAW_GATEWAY_TOKEN.
set -euo pipefail

PORT="${OPENCLAW_GATEWAY_PORT:-8000}"
TOKEN="${OPENCLAW_GATEWAY_TOKEN:?OPENCLAW_GATEWAY_TOKEN must be set}"
CLAWG_UI_DIR="$(cd "$(dirname "$0")" && pwd)/clawg-ui"

echo "[setup] baseline config + workspace"
# setup exits non-zero on its post-setup gateway health probe (no gateway yet); side effects already applied.
openclaw setup --non-interactive --accept-risk >/dev/null 2>&1 || true

echo "[setup] bake gateway token + port; reasoningDefault=stream (streams answer tokens AND surfaces reasoning as REASONING_* events; frontend @ag-ui/client >=0.0.52 parses them, CopilotKit renders the reasoning panel)"
openclaw config patch --stdin >/dev/null <<JSON
{
  gateway: { auth: { mode: "token", token: "$TOKEN" }, port: $PORT, bind: "loopback" },
  agents: { defaults: { reasoningDefault: "stream" } }
}
JSON

echo "[setup] configure OpenAI model from env key"
printf '%s\n' "${OPENAI_API_KEY:?OPENAI_API_KEY must be set}" \
  | openclaw models auth paste-api-key --provider openai >/dev/null

# Route model calls through an OpenAI-compatible endpoint (e.g. aimock) when set,
# for deterministic showcase demos. Unset => real OpenAI.
if [ -n "${OPENAI_BASE_URL:-}" ]; then
  echo "[setup] routing openai provider at OPENAI_BASE_URL=$OPENAI_BASE_URL"
  openclaw config patch --stdin >/dev/null <<JSON
{ models: { providers: { openai: { baseUrl: "$OPENAI_BASE_URL" } } } }
JSON
fi

echo "[setup] install forked clawg-ui plugin (vendored; includes token-streaming fix)"
openclaw plugins install "$CLAWG_UI_DIR" --force >/dev/null 2>&1 \
  || openclaw plugins install "$CLAWG_UI_DIR" >/dev/null 2>&1

# `plugins install` copies the plugin source but not always its node_modules, so
# the installed copy can't resolve @ag-ui/core. Copy the build-time-resolved deps
# into the installed plugin dir (no network) so it loads.
EXT="${HOME:-/root}/.openclaw/extensions/clawg-ui"
if [ -d "$EXT" ] && [ ! -d "$EXT/node_modules" ] && [ -d "$CLAWG_UI_DIR/node_modules" ]; then
  echo "[setup] copying plugin node_modules into $EXT"
  cp -R "$CLAWG_UI_DIR/node_modules" "$EXT/node_modules"
fi

echo "[setup] done"
