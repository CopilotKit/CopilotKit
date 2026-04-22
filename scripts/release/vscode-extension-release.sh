#!/usr/bin/env bash
# Bump version, commit, tag, and push for the VS Code extension.
#
# Usage:
#   scripts/release/vscode-extension-release.sh <patch|minor|major|X.Y.Z> [--dry-run]
#
# Runs a tag-triggered publish via .github/workflows/publish-vscode-extension.yml
# which packages the VSIX once and publishes to VS Code Marketplace + Open VSX.
#
# Requirements:
#   - Clean working tree on the branch you intend to release from (typically main).
#   - pnpm, node, git installed.
#
# Conventions:
#   - Package lives at packages/vscode-extension (name: copilotkit-vscode-extension).
#   - Tag format: vscode-extension-v<version>
#   - Commit message: chore(vscode-extension): release v<version>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PKG_DIR="${REPO_ROOT}/packages/vscode-extension"

DRY_RUN=0
BUMP=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$arg" ;;
    -h|--help)
      sed -n '1,22p' "$0"
      exit 0
      ;;
    *)
      echo "error: unrecognized argument '$arg'" >&2
      exit 2
      ;;
  esac
done

if [ -z "$BUMP" ]; then
  echo "error: missing bump level or explicit version" >&2
  echo "usage: $0 <patch|minor|major|X.Y.Z> [--dry-run]" >&2
  exit 2
fi

if [ ! -f "${PKG_DIR}/package.json" ]; then
  echo "error: ${PKG_DIR}/package.json not found" >&2
  exit 1
fi

if ! git -C "$REPO_ROOT" diff-index --quiet HEAD --; then
  echo "error: working tree is dirty; commit or stash first" >&2
  exit 1
fi

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
echo "Releasing vscode-extension from branch: ${BRANCH}"

cd "$PKG_DIR"

# pnpm version accepts 'patch'/'minor'/'major' OR an explicit SemVer string.
# --no-git-tag-version prevents pnpm from making its own commit/tag; we do it ourselves.
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] would run: pnpm version $BUMP --no-git-tag-version"
  # Peek at what the new version would be without mutating the file.
  # Use pnpm version itself in a throwaway copy to get accurate semver behavior.
  TMPDIR=$(mktemp -d)
  cp package.json "$TMPDIR/package.json"
  (cd "$TMPDIR" && pnpm version "$BUMP" --no-git-tag-version >/dev/null 2>&1)
  NEW_VERSION=$(node -p "require('$TMPDIR/package.json').version")
  rm -rf "$TMPDIR"
  echo "[dry-run] next version would be: $NEW_VERSION"
else
  pnpm version "$BUMP" --no-git-tag-version >/dev/null
  NEW_VERSION=$(node -p "require('./package.json').version")
fi

TAG="vscode-extension-v${NEW_VERSION}"
COMMIT_MSG="chore(vscode-extension): release v${NEW_VERSION}"

cd "$REPO_ROOT"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] would run:"
  echo "  git add packages/vscode-extension/package.json"
  echo "  git commit -m \"${COMMIT_MSG}\""
  echo "  git tag ${TAG}"
  echo "  git push --follow-tags"
  echo "[dry-run] reverting package.json changes"
  git -C "$REPO_ROOT" checkout -- "${PKG_DIR}/package.json" 2>/dev/null || true
  exit 0
fi

git add "${PKG_DIR}/package.json"
git commit -m "${COMMIT_MSG}"
git tag "${TAG}"
git push --follow-tags

echo ""
echo "Released ${TAG}"
echo "Watch CI: https://github.com/CopilotKit/CopilotKit/actions/workflows/publish-vscode-extension.yml"
