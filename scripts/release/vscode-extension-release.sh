#!/usr/bin/env bash
# Cut a release commit for the VS Code extension.
#
# Mirrors the CopilotKit/aimock release pattern:
#   1. Bump packages/vscode-extension/package.json
#   2. Prepend a new section to packages/vscode-extension/CHANGELOG.md
#   3. Create a single commit: "chore(vscode-extension): release vX.Y.Z"
#
# You then open a PR with this commit. When the PR merges to main,
# .github/workflows/publish-vscode-extension.yml runs, checks the Marketplace
# for the new version, and publishes to both Marketplace and Open VSX.
#
# This script does NOT create a git tag and does NOT push — tagging and
# release-creation are handled by CI after a successful publish, exactly
# like aimock. That keeps human error out of the tag ↔ version mapping.
#
# Usage:
#   scripts/release/vscode-extension-release.sh <patch|minor|major|X.Y.Z> \
#       --summary "One-line summary of what's in this release" \
#       [--type Added|Changed|Fixed|Removed|Deprecated|Security] \
#       [--dry-run]
#
# Multiple bullets: repeat --summary. Each becomes a bullet in CHANGELOG.md.
# Default section type is "Changed" when --type is omitted.
#
# Examples:
#   scripts/release/vscode-extension-release.sh patch \
#       --summary "Fix Hook Explorer crash on empty workspace" --type Fixed
#
#   scripts/release/vscode-extension-release.sh minor \
#       --summary "Add AG-UI Inspector panel" --type Added \
#       --summary "Rework sidebar layout" --type Changed
#
#   scripts/release/vscode-extension-release.sh 0.3.0 \
#       --summary "Stabilize A2UI Preview for GA" --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PKG_DIR="${REPO_ROOT}/packages/vscode-extension"
CHANGELOG="${PKG_DIR}/CHANGELOG.md"

DRY_RUN=0
BUMP=""
# Parallel arrays of summaries + their section type.
SUMMARIES=()
TYPES=()
PENDING_TYPE="Changed"

usage() {
  sed -n '1,36p' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --summary)
      if [ $# -lt 2 ]; then
        echo "error: --summary requires a value" >&2
        exit 2
      fi
      SUMMARIES+=("$2")
      TYPES+=("$PENDING_TYPE")
      shift 2
      ;;
    --type)
      if [ $# -lt 2 ]; then
        echo "error: --type requires a value" >&2
        exit 2
      fi
      case "$2" in
        Added|Changed|Fixed|Removed|Deprecated|Security)
          PENDING_TYPE="$2"
          # Retroactively apply to the most recent --summary if --type came after.
          if [ ${#SUMMARIES[@]} -gt 0 ]; then
            TYPES[${#TYPES[@]}-1]="$2"
          fi
          ;;
        *)
          echo "error: --type must be one of Added|Changed|Fixed|Removed|Deprecated|Security" >&2
          exit 2
          ;;
      esac
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    patch|minor|major)
      BUMP="$1"
      shift
      ;;
    [0-9]*.[0-9]*.[0-9]*)
      BUMP="$1"
      shift
      ;;
    *)
      echo "error: unrecognized argument '$1'" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$BUMP" ]; then
  echo "error: missing bump level or explicit version" >&2
  usage >&2
  exit 2
fi

if [ ${#SUMMARIES[@]} -eq 0 ]; then
  echo "error: at least one --summary is required" >&2
  usage >&2
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

# Compute the new version. `pnpm version` is semver-aware; run with
# --no-git-tag-version so it only rewrites package.json.
cd "$PKG_DIR"
if [ "$DRY_RUN" -eq 1 ]; then
  TMPDIR=$(mktemp -d)
  cp package.json "$TMPDIR/package.json"
  (cd "$TMPDIR" && pnpm version "$BUMP" --no-git-tag-version >/dev/null 2>&1)
  NEW_VERSION=$(node -p "require('$TMPDIR/package.json').version")
  rm -rf "$TMPDIR"
else
  pnpm version "$BUMP" --no-git-tag-version >/dev/null
  NEW_VERSION=$(node -p "require('./package.json').version")
fi

DATE=$(date -u +%Y-%m-%d)

# Build the new CHANGELOG section in memory, grouped by section type in
# the order Added → Changed → Fixed → Removed → Deprecated → Security.
# aimock uses a "## <version>" heading (no date); we add the ISO date after
# the version for clarity since this is a less-frequent release cadence.
SECTION_ORDER=(Added Changed Fixed Removed Deprecated Security)

NEW_SECTION=$(mktemp)
{
  echo "## ${NEW_VERSION} — ${DATE}"
  echo ""
  for section in "${SECTION_ORDER[@]}"; do
    # Collect summaries whose type matches this section.
    first=1
    for i in "${!SUMMARIES[@]}"; do
      if [ "${TYPES[$i]}" = "$section" ]; then
        if [ $first -eq 1 ]; then
          echo "### ${section}"
          echo ""
          first=0
        fi
        echo "- ${SUMMARIES[$i]}"
      fi
    done
    if [ $first -eq 0 ]; then
      echo ""
    fi
  done
} > "$NEW_SECTION"

# Compose the new CHANGELOG. If the file exists, preserve the top-level
# header (first "# <title>" block) and prepend the new section above the
# existing version sections. If not, create a fresh CHANGELOG with the
# canonical "# copilotkit-vscode-extension" header (matches aimock's
# "# @copilotkit/aimock" style).
NEW_CHANGELOG=$(mktemp)
if [ -f "$CHANGELOG" ]; then
  # Split existing file into header block + rest.
  awk '
    BEGIN { in_header = 1 }
    in_header && /^## / { in_header = 0 }
    in_header { print > "/dev/stderr" }
    !in_header { print }
  ' "$CHANGELOG" > "${NEW_CHANGELOG}.rest" 2> "${NEW_CHANGELOG}.header"

  # Header may be empty if the file was just sections with no title.
  if [ -s "${NEW_CHANGELOG}.header" ]; then
    cat "${NEW_CHANGELOG}.header" > "$NEW_CHANGELOG"
  else
    echo "# copilotkit-vscode-extension" > "$NEW_CHANGELOG"
    echo "" >> "$NEW_CHANGELOG"
  fi
  cat "$NEW_SECTION" >> "$NEW_CHANGELOG"
  if [ -s "${NEW_CHANGELOG}.rest" ]; then
    cat "${NEW_CHANGELOG}.rest" >> "$NEW_CHANGELOG"
  fi
  rm -f "${NEW_CHANGELOG}.rest" "${NEW_CHANGELOG}.header"
else
  {
    echo "# copilotkit-vscode-extension"
    echo ""
    cat "$NEW_SECTION"
  } > "$NEW_CHANGELOG"
fi

COMMIT_MSG="chore(vscode-extension): release v${NEW_VERSION}"

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "[dry-run] next version: ${NEW_VERSION}"
  echo "[dry-run] new CHANGELOG section:"
  echo "--------"
  cat "$NEW_SECTION"
  echo "--------"
  echo "[dry-run] would run:"
  echo "  cp (new changelog) -> ${CHANGELOG}"
  echo "  git add packages/vscode-extension/package.json packages/vscode-extension/CHANGELOG.md"
  echo "  git commit -m \"${COMMIT_MSG}\""
  echo "[dry-run] reverting package.json changes"
  git -C "$REPO_ROOT" checkout -- "${PKG_DIR}/package.json" 2>/dev/null || true
  rm -f "$NEW_SECTION" "$NEW_CHANGELOG"
  exit 0
fi

mv "$NEW_CHANGELOG" "$CHANGELOG"
rm -f "$NEW_SECTION"

cd "$REPO_ROOT"
git add "${PKG_DIR}/package.json" "${PKG_DIR}/CHANGELOG.md"
git commit -m "${COMMIT_MSG}"

echo ""
echo "Created release commit for ${NEW_VERSION}"
echo "  Version: ${NEW_VERSION}"
echo "  CHANGELOG: packages/vscode-extension/CHANGELOG.md"
echo ""
echo "Next steps:"
echo "  1. Push the branch and open a PR against main."
echo "  2. Merge the PR (no squash — use --merge)."
echo "  3. CI (.github/workflows/publish-vscode-extension.yml) will detect the"
echo "     version is not yet on the Marketplace, build, publish to Marketplace"
echo "     and Open VSX, tag vscode-extension-v${NEW_VERSION}, and cut a GH Release."
echo ""
echo "Watch: https://github.com/CopilotKit/CopilotKit/actions/workflows/publish-vscode-extension.yml"
