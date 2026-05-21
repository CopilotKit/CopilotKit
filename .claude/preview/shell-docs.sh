#!/usr/bin/env bash
# Spin up a local preview of showcase/shell-docs.
#
# Idempotent: re-running is safe. Installs only what's missing, regenerates
# the gitignored data JSONs, then starts `next dev` on :3003.
#
# Background: shell-docs is npm-managed (its own package-lock.json) and is
# explicitly excluded from the pnpm workspace. The predev step depends on
# `showcase/scripts`, which IS a pnpm workspace package — so we install
# both with their own package manager.
#
# Usage (from any directory inside the repo / a worktree):
#   ./.claude/preview/shell-docs.sh
#
# Env you can override:
#   PORT                    default 3003
#   NEXT_PUBLIC_BASE_URL    default http://localhost:$PORT
#   NEXT_PUBLIC_SHELL_URL   default http://localhost:3000
set -euo pipefail

PORT="${PORT:-3003}"
NEXT_PUBLIC_BASE_URL="${NEXT_PUBLIC_BASE_URL:-http://localhost:$PORT}"
NEXT_PUBLIC_SHELL_URL="${NEXT_PUBLIC_SHELL_URL:-http://localhost:3000}"

# Resolve repo root from this script's location: <root>/.claude/preview/shell-docs.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHELL_DOCS_DIR="$REPO_ROOT/showcase/shell-docs"
SCRIPTS_DIR="$REPO_ROOT/showcase/scripts"

if [[ ! -d "$SHELL_DOCS_DIR" ]]; then
  echo "error: $SHELL_DOCS_DIR not found — run this from inside the CopilotKit repo or a worktree." >&2
  exit 1
fi

echo "==> Repo:        $REPO_ROOT"
echo "==> Port:        $PORT"
echo "==> Base URL:    $NEXT_PUBLIC_BASE_URL"
echo "==> Shell URL:   $NEXT_PUBLIC_SHELL_URL"

# 1) showcase/scripts (pnpm workspace) — needed for the predev generators.
#    Only install if its node_modules is missing. The root prepare/lefthook
#    postinstall hook can fail on worktrees due to core.hooksPath; we don't
#    care, deps still land. Suppress non-fatal hook failures.
if [[ ! -d "$SCRIPTS_DIR/node_modules" ]]; then
  echo "==> Installing showcase/scripts workspace deps via pnpm…"
  ( cd "$REPO_ROOT" && pnpm install --filter @copilotkit/showcase-scripts ) || {
    echo "   (root prepare hook may have failed — that's expected on worktrees; deps installed regardless)"
  }
else
  echo "==> showcase/scripts deps already present, skipping install."
fi

# 2) shell-docs (npm) — only install if its node_modules is missing.
if [[ ! -d "$SHELL_DOCS_DIR/node_modules" ]]; then
  echo "==> Installing showcase/shell-docs deps via npm…"
  ( cd "$SHELL_DOCS_DIR" && npm install )
else
  echo "==> shell-docs deps already present, skipping install."
fi

# 3) Predev generators — registry, demo content, search index.
#    These produce gitignored JSON under shell-docs/src/data/*.json.
echo "==> Generating registry / demo content / search index…"
cd "$SHELL_DOCS_DIR"
npx tsx ../scripts/generate-registry.ts >/dev/null
npx tsx ../scripts/bundle-demo-content.ts >/dev/null
npx tsx ../scripts/generate-search-index.ts >/dev/null
echo "    done."

# 4) Boot next dev. Stays in foreground so Ctrl-C kills it cleanly.
echo
echo "==> Starting next dev on http://localhost:$PORT …"
echo "    (Ctrl-C to stop)"
echo
exec env \
  NEXT_PUBLIC_BASE_URL="$NEXT_PUBLIC_BASE_URL" \
  NEXT_PUBLIC_SHELL_URL="$NEXT_PUBLIC_SHELL_URL" \
  npx next dev --port "$PORT"
