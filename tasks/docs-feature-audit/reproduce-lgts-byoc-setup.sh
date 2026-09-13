#!/usr/bin/env bash
# Reproduces the documented complete LangGraph TypeScript Showcase agent setup
# without starting an agent server. Run from the repository root.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
temp_root="$(mktemp -d /private/tmp/lgts-showcase-agent.XXXXXX)"
trap 'rm -rf "$temp_root"' EXIT

# This mirrors the directory produced by the guide's clone command while
# deliberately excluding installed dependencies. The selected graph imports
# files outside src/agent, so copying only its rendered snippets would not
# reproduce the documented runnable sample.
tar -C "$repo_root/showcase/integrations" \
  --exclude='langgraph-typescript/node_modules' \
  --exclude='langgraph-typescript/src/agent/node_modules' \
  -cf - langgraph-typescript | tar -C "$temp_root" -xf -

integration_root="$temp_root/langgraph-typescript"
cp "$integration_root/.env.example" "$integration_root/.env"
cd "$integration_root/src/agent"
NODE_OPTIONS=--max-old-space-size=4096 npm ci --ignore-scripts --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/tsc \
  --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 \
  --skipLibCheck graph.ts
