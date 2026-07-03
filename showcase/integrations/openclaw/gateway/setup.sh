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
  agents: { defaults: { reasoningDefault: "stream", skipBootstrap: true } }
}
JSON

# The stock "fresh workspace" flow seeds a BOOTSTRAP.md that makes the agent open
# every session with an identity-establishing monologue ("who am I? what's my
# vibe? signature emoji?") instead of doing the task — and our stateless
# client-tool runs use a fresh session each turn, so it fired every time.
# `skipBootstrap` above stops OpenClaw from RE-creating it; here we remove the
# one `openclaw setup` just wrote and seed a fixed identity + tool-forward
# guidance so the agent is stable and calls provided tools promptly. All
# gateway-config/workspace seeding — no OpenClaw source or adapter changes.
echo "[setup] seed stable agent identity + tool-forward guidance (suppress bootstrap chatter)"
WS="${HOME:-/root}/.openclaw/workspace"
mkdir -p "$WS"
rm -f "$WS/BOOTSTRAP.md"
cat > "$WS/IDENTITY.md" <<'MD'
# IDENTITY.md
- **Name:** Claw
- **Creature:** AI assistant
- **Vibe:** calm, direct, task-focused
- **Emoji:** 🦞
MD
cat > "$WS/AGENTS.md" <<'MD'
# AGENTS.md

You are Claw, a task-oriented assistant embedded in a CopilotKit demo. Your
identity is already established — never ask the user who you are, what to call
you, your vibe, or a signature emoji, and never run a first-run/bootstrap ritual.

## How to work
- On any actionable request, act in the current turn. Prefer calling an available
  tool over describing what could be done.
- When a provided tool matches the user's request, you MUST call it with your best
  arguments — do not reply with a prose plan when a tool can perform or advance the
  action.
- If the user asks you to approve, confirm, decide, schedule, or otherwise get a
  human's input, and a matching tool is available (e.g. an approval, confirmation,
  or scheduling tool), you MUST call that tool to surface the request to the user.
  The tool IS your mechanism to obtain the decision — never decline or claim you
  "lack access to a system" when such a tool is provided. Treat the tool's returned
  value as the authoritative decision and continue accordingly.
- Keep replies concise. No greeting-only or identity-establishing messages.
MD

echo "[setup] configure OpenAI model from env key"
printf '%s\n' "${OPENAI_API_KEY:?OPENAI_API_KEY must be set}" \
  | openclaw models auth paste-api-key --provider openai >/dev/null

# Route model calls through an OpenAI-compatible endpoint (e.g. aimock) when set,
# for deterministic showcase demos. Unset => real OpenAI.
# When routed at aimock, also inject the static X-AIMock-Context header on every
# outbound LLM request: unlike the in-process peers, OpenClaw's model call happens
# in this separate gateway process, so the browser's per-request header never
# reaches it — but the container serves exactly one slug, so the context is
# constant and can be baked as a provider header here.
if [ -n "${OPENAI_BASE_URL:-}" ]; then
  echo "[setup] routing openai provider at OPENAI_BASE_URL=$OPENAI_BASE_URL (+ X-AIMock-Context: openclaw)"
  openclaw config patch --stdin >/dev/null <<JSON
{ models: { providers: { openai: { baseUrl: "$OPENAI_BASE_URL", headers: { "X-AIMock-Context": "openclaw" } } } } }
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
