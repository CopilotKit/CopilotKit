#!/bin/bash
set -euo pipefail

# Install skills from an external git repo into ~/.claude/skills/ at the start
# of every Claude Code on the web session.
#
# Configuration (env vars, admin-configured on the cloud environment):
#   SKILLS_REPO  — GitHub repo in "owner/name" form (required)
#   SKILLS_TOKEN — GitHub token with read access to SKILLS_REPO (required)
#   SKILLS_REF   — git ref to pin to; defaults to the default branch (optional)
#
# The target repo must also be on the sandbox git-proxy allowlist, otherwise
# the clone is blocked at the network layer regardless of token.
#
# No-ops cleanly when not in a remote session or when required vars are unset.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ -z "${SKILLS_REPO:-}" ] || [ -z "${SKILLS_TOKEN:-}" ]; then
  echo "[session-start] SKILLS_REPO/SKILLS_TOKEN not set; skipping skills install" >&2
  exit 0
fi

SKILLS_DIR="$HOME/.claude/skills"
CACHE_DIR="$HOME/.cache/session-start-skills"
REMOTE_URL="https://github.com/${SKILLS_REPO}.git"
AUTH_URL="https://x-access-token:${SKILLS_TOKEN}@github.com/${SKILLS_REPO}.git"
REF="${SKILLS_REF:-HEAD}"

mkdir -p "$SKILLS_DIR" "$(dirname "$CACHE_DIR")"

if [ ! -d "$CACHE_DIR/.git" ]; then
  git clone --depth 1 --quiet "$AUTH_URL" "$CACHE_DIR"
fi

git -C "$CACHE_DIR" remote set-url origin "$AUTH_URL"
git -C "$CACHE_DIR" fetch --depth 1 --quiet origin "$REF"
git -C "$CACHE_DIR" reset --hard --quiet FETCH_HEAD

# Scrub the token from the on-disk git config.
git -C "$CACHE_DIR" remote set-url origin "$REMOTE_URL"

installed=0
for skill_dir in "$CACHE_DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_name=$(basename "$skill_dir")
  case "$skill_name" in .*) continue;; esac
  if [ -f "$skill_dir/SKILL.md" ]; then
    ln -sfn "$skill_dir" "$SKILLS_DIR/$skill_name"
    installed=$((installed + 1))
  fi
done

echo "[session-start] installed $installed skill(s) from ${SKILLS_REPO} into $SKILLS_DIR" >&2
