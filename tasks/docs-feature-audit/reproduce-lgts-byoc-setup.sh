#!/usr/bin/env bash
# Reproduces the documented LangGraph TypeScript BYO agent install/typecheck
# without starting an agent server. Run from the repository root.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
temp_root="$(mktemp -d /private/tmp/lgts-byoc-setup.XXXXXX)"
trap 'rm -rf "$temp_root"' EXIT

mkdir -p "$temp_root/src"
cp -R "$repo_root/showcase/integrations/langgraph-typescript/src/agent" "$temp_root/src/agent"
cp -R "$repo_root/showcase/integrations/langgraph-typescript/shared-tools" "$temp_root/shared-tools"

cd "$temp_root/src/agent"
NODE_OPTIONS=--max-old-space-size=4096 npm install --ignore-scripts --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/tsc \
  --noEmit --module nodenext --moduleResolution nodenext --target es2022 \
  --skipLibCheck graph.ts
