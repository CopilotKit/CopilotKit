#!/usr/bin/env bash
# Boot reproduction of the documented complete LangGraph TypeScript Showcase
# agent setup (/langgraph-typescript/quickstart, TypeScript tab, "Want the
# complete runnable Showcase agent?" callout). Run from the repository root.
#
# Differences from reproduce-lgts-byoc-setup.sh (2026-09-13, left unchanged):
#   * copies only what a clone of the working tree contains
#     (`git ls-files -co --exclude-standard`), so ignored local state such as
#     .env, .next/, node_modules/ and src/agent/.langgraph_api/ is not carried;
#   * runs the documented commands verbatim (`npm ci`, then `npm run dev`)
#     instead of `npm ci --ignore-scripts` + a typecheck;
#   * waits for the agent to bind 8123, lists the registered graphs, asks the
#     server for each graph's structure, then stops the process group.
# The documented step "Set OPENAI_API_KEY in .env" is satisfied with a
# placeholder; no model request is made.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
port=8123
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $port is already in use; refusing to start" >&2
  exit 2
fi

temp_root="$(mktemp -d /private/tmp/lgts-byoc-boot.XXXXXX)"
dev_pgid=""
cleanup() {
  if [[ -n "$dev_pgid" ]]; then
    kill -TERM -- "-$dev_pgid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      ps -axo pgid= | awk -v g="$dev_pgid" '$1==g{found=1} END{exit !found}' || break
      sleep 1
    done
    kill -KILL -- "-$dev_pgid" 2>/dev/null || true
  fi
  rm -rf "$temp_root"
}
trap cleanup EXIT

# 1. "git clone ... && cd CopilotKit/showcase/integrations/langgraph-typescript"
(cd "$repo_root" && git ls-files -co --exclude-standard -z showcase/integrations/langgraph-typescript) |
  (cd "$repo_root" && tar --null -T - -cf -) | tar -C "$temp_root" -xf -
integration_root="$temp_root/showcase/integrations/langgraph-typescript"
cd "$integration_root"
echo "copied $(find . -type f | wc -l | tr -d ' ') files; node_modules present: $(test -e node_modules && echo yes || echo no); .langgraph_api present: $(test -e src/agent/.langgraph_api && echo yes || echo no)"

# 2. "cp .env.example .env" and "Set OPENAI_API_KEY in .env"
cp .env.example .env
sed -i '' 's/^OPENAI_API_KEY=.*/OPENAI_API_KEY=sk-placeholder-not-used/' .env

# 3. "cd src/agent && npm ci"
cd src/agent
SCARF_ANALYTICS=false npm ci --no-audit --no-fund
npm ls --depth=0 @copilotkit/sdk-js @langchain/core @langchain/langgraph @langchain/langgraph-api @langchain/langgraph-cli @langchain/langgraph-sdk langchain || true

# 4. "npm run dev" (own session so the whole tree can be stopped)
log="$temp_root/dev.log"
LANGSMITH_TRACING=false perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' npm run dev >"$log" 2>&1 </dev/null &
dev_pgid=$!
status=""
for i in $(seq 1 120); do
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/ok" || true)"
  [[ "$status" == 200 ]] && break
  kill -0 "$dev_pgid" 2>/dev/null || break
  sleep 1
done
echo "GET http://localhost:$port/ok -> ${status:-none} after ${i}s"
echo "--- dev log (ANSI stripped, per-graph lines collapsed)"
sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -v "graph_id:" | grep -v "Registering graph with id" || true
echo "registered graphs: $(grep -c "Registering graph with id" "$log" || true)"

if [[ "$status" == 200 ]]; then
  echo "--- per-graph structure (GET /assistants/<id>/graph)"
  curl -s -X POST "http://localhost:$port/assistants/search" -H 'content-type: application/json' \
    -d '{"limit":100}' |
    node -e '
      const list = JSON.parse(require("fs").readFileSync(0, "utf8"));
      (async () => {
        for (const a of list) {
          const r = await fetch(`http://localhost:'"$port"'/assistants/${a.assistant_id}/graph`);
          const body = await r.text();
          console.log(`${a.graph_id}\t${r.status}\t${r.ok ? "" : body.slice(0, 200)}`);
        }
      })();'
  echo "--- dev log lines after graph requests"
  sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -i -E "error|cannot find|not found|ERR_" | head -20 || true
fi
