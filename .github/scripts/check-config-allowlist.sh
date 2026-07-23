#!/usr/bin/env bash
set -euo pipefail

ALLOWLIST=".github/config-allowlist.txt"

if [ ! -f "$ALLOWLIST" ]; then
  echo "ERROR: Allowlist file $ALLOWLIST not found" >&2
  exit 1
fi

PATTERNS=(
  -name 'vite.config.*'
  -o -name 'vite_*.mjs' -o -name 'vite_*.ts' -o -name 'vite_*.js'
  -o -name 'vite-*.mjs' -o -name 'vite-*.ts' -o -name 'vite-*.js'
  -o -name 'tsdown.config.*'
  -o -name 'tsup.config.*'
  -o -name 'rollup.config.*'
  -o -name 'webpack.config.*'
  -o -name 'esbuild.config.*'
  -o -name 'next.config.*'
)

FOUND=$(find . \
  -path './node_modules' -prune -o \
  -path './.claude' -prune -o \
  -path './.next' -prune -o \
  -path '*/node_modules' -prune -o \
  -path '*/dist' -prune -o \
  -path '*/.next' -prune -o \
  \( "${PATTERNS[@]}" \) -print |
  sed 's|^\./||' |
  sort)

UNEXPECTED=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if ! grep -qxF "$file" "$ALLOWLIST"; then
    UNEXPECTED="${UNEXPECTED}${file}"$'\n'
  fi
done <<< "$FOUND"

if [ -n "$UNEXPECTED" ]; then
  echo "::error::Unexpected build config files detected (not in allowlist):"
  echo "$UNEXPECTED" | while IFS= read -r f; do
    [ -n "$f" ] && echo "  - $f"
  done
  echo ""
  echo "If these are legitimate, add them to $ALLOWLIST and get CODEOWNERS approval."
  exit 1
fi

echo "All build config files are on the allowlist."
