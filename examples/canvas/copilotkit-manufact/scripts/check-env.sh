#!/usr/bin/env bash
# scripts/check-env.sh — pre-flight wired into `predev` (npm convention).
#
# Validates, in order, that everything `npm run dev` needs is in place:
#   1. Docker daemon up.
#   2. npx is available so `@notionhq/notion-mcp-server` can be fetched
#      on demand. We don't pull the package here (slow) — we just prove
#      the resolver works.
#   3. agent/.env exists and has GEMINI_API_KEY, NOTION_TOKEN, and
#      NOTION_LEADS_DATABASE_ID set to non-stub values.
#   4. Notion is reachable AND the leads database is shared with the
#      integration. Defers to `agent/src/notion_tools.py --check`, which
#      reports an actionable FAIL: with the share-gotcha fix on a 404.
#
# Collects every problem into a numbered list rather than bailing on the
# first failure, so participants can fix the whole batch in one pass.
# Exit 0 silently on success.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROBLEMS=()

# ---------- 1. Docker daemon -------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  PROBLEMS+=("Docker isn't installed. Install Docker Desktop and re-try.")
elif ! docker info >/dev/null 2>&1; then
  PROBLEMS+=("Docker isn't running. Start Docker Desktop and re-try.")
fi

# ---------- 2. npx (for the Notion MCP server) -------------------------------
if ! command -v npx >/dev/null 2>&1; then
  PROBLEMS+=("npx is not on PATH. Install Node.js 20+ (npm bundles npx).")
fi

# ---------- 3. agent/.env vars -----------------------------------------------
AGENT_ENV="$REPO_ROOT/agent/.env"
if [[ ! -f "$AGENT_ENV" ]]; then
  PROBLEMS+=("agent/.env is missing. Run: cp agent/.env.example agent/.env, then fill in the keys.")
else
  # Read VAR=VALUE lines. We tolerate values without quotes (the .env files
  # ship without quotes) and strip surrounding whitespace.
  read_var() {
    local key="$1"
    grep -E "^[[:space:]]*${key}=" "$AGENT_ENV" | tail -n1 | sed -E "s/^[[:space:]]*${key}=//; s/^[\"']//; s/[\"'][[:space:]]*$//; s/[[:space:]]+$//"
  }
  is_stub() {
    local v="$1"
    [[ -z "$v" ]] && return 0
    case "$v" in
      stub*|"<paste"*|"<set"*|"replace-with-"*) return 0 ;;
    esac
    return 1
  }
  for VAR in GEMINI_API_KEY NOTION_TOKEN NOTION_LEADS_DATABASE_ID; do
    val="$(read_var "$VAR" || true)"
    if is_stub "$val"; then
      case "$VAR" in
        GEMINI_API_KEY)
          PROBLEMS+=("$VAR is unset (or a stub) in agent/.env. Get a key at https://aistudio.google.com -> Get API key.")
          ;;
        NOTION_TOKEN)
          PROBLEMS+=("$VAR is unset (or a stub) in agent/.env. Get a token at https://notion.so/my-integrations -> New integration -> Internal Integration Token.")
          ;;
        NOTION_LEADS_DATABASE_ID)
          PROBLEMS+=("$VAR is unset in agent/.env. Paste the database id from your Notion database URL.")
          ;;
      esac
    fi
  done
fi

# ---------- 4. Notion reachable + database shared ---------------------------
# Only run the live health check if the env vars passed (no point hitting the
# network when we know auth will fail). The script prints OK: ... or FAIL: ...
# with the share-gotcha fix on a 404.
if [[ ${#PROBLEMS[@]} -eq 0 ]]; then
  HEALTH_OUT="$(cd "$REPO_ROOT/agent" && uv run python -m src.notion_tools --check 2>&1 || true)"
  if ! grep -q "^OK: " <<<"$HEALTH_OUT"; then
    # Pass the FAIL output through verbatim — the --check flag already
    # formats the share-gotcha fix instructions when applicable.
    PROBLEMS+=("Notion health check failed:
$HEALTH_OUT")
  fi
fi

# ---------- Report -----------------------------------------------------------
if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
  echo ""
  echo "Pre-flight check found ${#PROBLEMS[@]} problem(s):"
  echo ""
  i=1
  for p in "${PROBLEMS[@]}"; do
    # Indent multi-line problems so they read as one item.
    first_line="${p%%$'\n'*}"
    rest="${p#*$'\n'}"
    echo "  $i. $first_line"
    if [[ "$rest" != "$p" ]]; then
      while IFS= read -r line; do
        echo "     $line"
      done <<<"$rest"
    fi
    i=$((i+1))
  done
  echo ""
  echo "Fix these and re-run \`npm run dev\`."
  exit 1
fi

exit 0
