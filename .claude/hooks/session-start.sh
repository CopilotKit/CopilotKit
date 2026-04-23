#!/bin/bash
set -euo pipefail

# Install private skills from copilotkit/internal-skills into ~/.claude/skills/
# at the start of every Claude Code on the web session.
#
# Requirements (admin-configured on the cloud environment):
#   1. INTERNAL_SKILLS_TOKEN env var — GitHub token (PAT or App installation
#      token) with read access to copilotkit/internal-skills.
#   2. copilotkit/internal-skills added to the sandbox git-proxy allowlist.
#
# Without both, the hook no-ops cleanly so local sessions and sessions missing
# the secret still start normally.

# Skip on local (non-remote) sessions — user's local ~/.claude/skills/ is the
# source of truth there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ -z "${INTERNAL_SKILLS_TOKEN:-}" ]; then
  echo "[session-start] INTERNAL_SKILLS_TOKEN not set; skipping internal skills install" >&2
  exit 0
fi

SKILLS_REPO="github.com/copilotkit/internal-skills.git"
SKILLS_DIR="$HOME/.claude/skills"
CACHE_DIR="$HOME/.cache/copilotkit-internal-skills"

mkdir -p "$SKILLS_DIR" "$(dirname "$CACHE_DIR")"

if [ -d "$CACHE_DIR/.git" ]; then
  git -C "$CACHE_DIR" remote set-url origin \
    "https://x-access-token:${INTERNAL_SKILLS_TOKEN}@${SKILLS_REPO}"
  git -C "$CACHE_DIR" fetch --depth 1 --quiet origin HEAD
  git -C "$CACHE_DIR" reset --hard --quiet FETCH_HEAD
else
  git clone --depth 1 --quiet \
    "https://x-access-token:${INTERNAL_SKILLS_TOKEN}@${SKILLS_REPO}" \
    "$CACHE_DIR"
fi

# Scrub the token from the on-disk git config so it doesn't linger in the
# sandbox filesystem longer than needed.
git -C "$CACHE_DIR" remote set-url origin "https://${SKILLS_REPO}"

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

echo "[session-start] installed $installed internal skill(s) into $SKILLS_DIR" >&2
