#!/usr/bin/env bash
# Runs React Doctor or impeccable detect on the React UI files that changed
# since a base ref, and fails on what they find. Only changed code is checked,
# so the findings that already exist do not need a baseline.
#
#   scripts/lint/react-ui-checks.sh react-doctor|impeccable [base-ref]
#
# The base ref defaults to origin/2.0.0. CI passes HEAD^1, the base branch tip
# of the pull request merge commit. See dev-docs/react-ui-checks.md.
set -euo pipefail

tool="${1:?usage: react-ui-checks.sh react-doctor|impeccable [base-ref]}"
base="${2:-origin/2.0.0}"
bin="$(git rev-parse --show-toplevel)/node_modules/.bin"

fork_point=$(git merge-base "$base" HEAD)

# Files changed since the fork point, committed or not, that match $1.
changed() {
  git diff --name-only --diff-filter=ACMR "$fork_point" -- packages examples showcase |
    grep -E "$1" || true
}

case "$tool" in
  react-doctor)
    # React Doctor's own --scope changed reports only new issues. It finds
    # pnpm workspace projects by itself, but showcase/ is not in the workspace,
    # so pass the changed React projects explicitly: the nearest directory with
    # a package.json that depends on react.
    projects=$(
      changed '\.(tsx|jsx|ts|js|mjs)$' | while read -r file; do
        dir=$(dirname "$file")
        while [ "$dir" != "." ] && [ ! -f "$dir/package.json" ]; do dir=$(dirname "$dir"); done
        if [ "$dir" != "." ] && grep -q '"react"' "$dir/package.json"; then echo "$dir"; fi
      done | sort -u | paste -sd, -
    )
    if [ -z "$projects" ]; then echo "React Doctor: no React project changed."; exit 0; fi
    exec "$bin/react-doctor" . --project "$projects" --scope changed --base "$fork_point" \
      --blocking warning --no-score --verbose
    ;;
  impeccable)
    # impeccable has no changed-only mode, so scan the changed files. Old
    # findings in a file you change count too: fix them or add an
    # impeccable-disable comment with the reason. Tests and stories are skipped.
    files=$(changed '\.(tsx|jsx|html|css|scss|vue|svelte)$' | grep -vE '(__tests__/|\.(test|spec|stories)\.)' || true)
    if [ -z "$files" ]; then echo "impeccable: no UI file changed."; exit 0; fi
    # shellcheck disable=SC2086 # one path per word
    exec "$bin/impeccable" detect ${GITHUB_ACTIONS:+--github} $files
    ;;
  *)
    echo "unknown tool: $tool (use react-doctor or impeccable)" >&2
    exit 2
    ;;
esac
