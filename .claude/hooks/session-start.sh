#!/bin/bash
set -euo pipefail

# Install skills from a git repo into ~/.claude/skills/ at the start of every
# Claude Code on the web session, by delegating to the repo's own
# scripts/install.sh.
#
# Configuration (env vars, admin-configured on the cloud environment):
#   SKILLS_REPO  — GitHub repo in "owner/name" form
#   SKILLS_TOKEN — GitHub token with read access to SKILLS_REPO
#
# The target repo must also be on the sandbox git-proxy allowlist.
# No-ops cleanly when not in a remote session or when required vars are unset.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ -z "${SKILLS_REPO:-}" ] || [ -z "${SKILLS_TOKEN:-}" ]; then
  echo "[session-start] SKILLS_REPO/SKILLS_TOKEN not set; skipping skills install" >&2
  exit 0
fi

REPO_NAME=$(basename "$SKILLS_REPO")
CACHE_DIR="$HOME/.local/share/$REPO_NAME"
REMOTE_URL="https://github.com/${SKILLS_REPO}.git"
AUTH_URL="https://x-access-token:${SKILLS_TOKEN}@github.com/${SKILLS_REPO}.git"

mkdir -p "$(dirname "$CACHE_DIR")"

if [ ! -d "$CACHE_DIR/.git" ]; then
  git clone --quiet "$AUTH_URL" "$CACHE_DIR"
fi

git -C "$CACHE_DIR" remote set-url origin "$AUTH_URL"
git -C "$CACHE_DIR" fetch --quiet origin HEAD
git -C "$CACHE_DIR" reset --hard --quiet FETCH_HEAD

# Scrub the token from the on-disk git config.
git -C "$CACHE_DIR" remote set-url origin "$REMOTE_URL"

INSTALLER="$CACHE_DIR/scripts/install.sh"
if [ ! -x "$INSTALLER" ]; then
  echo "[session-start] $INSTALLER not found; nothing to install" >&2
  exit 0
fi

# Delegate to the skills repo's canonical installer. GITHUB_TOKEN lets
# install.sh do authenticated git operations (clones, pulls) if it needs to.
GITHUB_TOKEN="$SKILLS_TOKEN" "$INSTALLER"
