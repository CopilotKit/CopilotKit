#!/usr/bin/env bash
# Rejects staged binary artifacts, build output, dSYM dirs, and files > 1 MB.
# Invoked by lefthook pre-commit. Lives in a standalone file so Windows Git Bash
# doesn't mangle the quoting when lefthook passes it through `sh.exe -c`.

set -eu

VIOLATIONS=0
STAGED=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$STAGED" ] && exit 0

BINARIES=$(echo "$STAGED" | grep -iE '\.(exe|dll|so|dylib|o|obj|a|lib|wasm)$' || true)
if [ -n "$BINARIES" ]; then
  echo "Binary files detected:"
  echo "$BINARIES"
  VIOLATIONS=1
fi

BUILD=$(echo "$STAGED" | grep -E '/build/' || true)
if [ -n "$BUILD" ]; then
  echo "Files in build directories:"
  echo "$BUILD"
  VIOLATIONS=1
fi

DSYM=$(echo "$STAGED" | grep -E '\.dSYM/' || true)
if [ -n "$DSYM" ]; then
  echo "dSYM directories:"
  echo "$DSYM"
  VIOLATIONS=1
fi

while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ ! -f "$f" ] && continue
  # Skip lockfiles and a small set of generated data files that legitimately
  # exceed 1 MB (showcase demo/search/starter content). Keeping the list
  # explicit — any other file over 1 MB still gets rejected.
  case "$f" in
    pnpm-lock.yaml|*/package-lock.json) continue ;;
    showcase/shell/src/data/demo-content.json) continue ;;
    showcase/shell/src/data/search-index.json) continue ;;
    showcase/shell/src/data/starter-content.json) continue ;;
    showcase/shell-docs/src/data/demo-content.json) continue ;;
    showcase/shell-docs/src/data/search-index.json) continue ;;
    showcase/shell-docs/src/data/starter-content.json) continue ;;
    showcase/shell-dojo/src/data/demo-content.json) continue ;;
    showcase/shell-dojo/src/data/search-index.json) continue ;;
    showcase/shell-dojo/src/data/starter-content.json) continue ;;
  esac
  SIZE=$(wc -c < "$f" | tr -d ' ')
  [ -z "$SIZE" ] && continue
  if [ "$SIZE" -gt 1048576 ]; then
    echo "Oversized file: $f ($((SIZE / 1024)) KB)"
    VIOLATIONS=1
  fi
done <<< "$STAGED"

# Explicit `if … then` (instead of `[ … ] && exit 1`) to avoid the brittle
# `set -e` interaction: with errexit enabled, a failing simple command as
# the penultimate line is only safe because the trailing `exit 0` follows.
# The explicit form is robust regardless of what comes after.
if [ "$VIOLATIONS" -eq 1 ]; then
  exit 1
fi
exit 0
