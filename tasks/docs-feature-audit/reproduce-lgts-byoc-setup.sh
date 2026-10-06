#!/usr/bin/env bash
# Reproduction of the LangGraph TypeScript quickstart's bring-your-own path
# (/langgraph-typescript/quickstart, "Use an existing agent"), as a
# TypeScript reader sees it. Run from the repository root.
#
# Replaces the 2026-09-23 boot variant (still in git history, and kept as
# reproduce-lgts-byoc-setup-20260923.sh), which only booted the Showcase
# agent. Modelled on reproduce-adk-byoc-setup.sh.
#
# * What the reader sees: extract-lgts-quickstart.py simulates the docs Tabs
#   component (one selection per groupId, TypeScript pre-selected on
#   /langgraph-typescript/*, LangSmith for the route, npm) and lists the
#   fenced blocks a TypeScript reader can see, in document order, annotation
#   comments removed. Nothing is transcribed by hand.
# * Phase "visible-path": the visible path must contain the agent
#   (src/agent.ts, langgraph.json), a runtime route
#   (app/api/copilotkit/route.ts) and a start command. Blocks that sit in a
#   TypeScript tab but are hidden from this reader are listed.
# * Phase "showcase-callout": the "Want the complete runnable Showcase agent?"
#   commands, run verbatim on a clone-equivalent copy of the integration
#   (`git ls-files -co --exclude-standard`, so ignored local state is not
#   carried): `cp .env.example .env`, `cd src/agent && npm ci && npm run dev`.
#   Waits for 8123, asks for every registered graph's structure, then stops.
# * Phase "existing-agent": the visible agent and frontend steps, run in a
#   fresh temp directory with the guide's own commands and files:
#   `mkdir my-agent && cd my-agent && npm init -y`, its `npm install` line,
#   its src/agent.ts and langgraph.json, its .env line (its own placeholder
#   key), its frontend `npm install` line, its LangSmith route.ts, and its
#   start block `cd .. && npx @langchain/langgraph-cli dev --port 8123
#   --no-browser`. `npm init -y` stands in for `npx create-next-app@latest
#   frontend`; the React files and the Intelligence steps
#   (`npx copilotkit@latest project select`) are not reproduced, and the route
#   runs with the guide's "Running without the Intelligence Platform?" callout
#   applied (drop `intelligence` and `identifyUser`). lgts-byoc-runtime-run.mts
#   then imports that route file and drives it the way the guide's provider
#   does (`useSingleEndpoint`, `agent="sample_agent"`): one `info` call and
#   one `agent/run` with the guide's first suggested prompt.
# * The model call goes to a scratch strict AIMock on :4411 holding one
#   fixture for that prompt, through the OpenAI SDK's own OPENAI_BASE_URL
#   environment variable. No request reaches OpenAI.
# * Other deviations, all environment-only: npm's --before (default
#   2026-10-05T12:00Z, >= 24 h before the audit run) bounds what npm and npx
#   resolve; LANGSMITH_TRACING=false, LANGGRAPH_CLI_NO_ANALYTICS=1 and
#   DO_NOT_TRACK=1 keep the run from reporting anywhere.
#
# Usage: reproduce-lgts-byoc-setup.sh [phase ...]
#   (default: visible-path showcase-callout existing-agent)
#   GUIDE=<file> points the script at another copy of the guide.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
guide="${GUIDE:-$repo_root/showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx}"
extractor="$repo_root/tasks/docs-feature-audit/extract-lgts-quickstart.py"
runner="$repo_root/tasks/docs-feature-audit/lgts-byoc-runtime-run.mts"
tsx="$repo_root/node_modules/.bin/tsx"
llmock="$repo_root/showcase/scripts/node_modules/.bin/llmock"
port=8123 mock_port=4411
bound="${NPM_BEFORE:-2026-10-05T12:00:00Z}"
export npm_config_before="$bound" npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
export LANGSMITH_TRACING=false LANGGRAPH_CLI_NO_ANALYTICS=1 DO_NOT_TRACK=1 SCARF_ANALYTICS=false
phases=("$@")
[[ ${#phases[@]} -eq 0 ]] && phases=(visible-path showcase-callout existing-agent)

for p in $port $mock_port; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p is already in use; refusing to start" >&2
    exit 2
  fi
done

temp_root="$(mktemp -d /private/tmp/lgts-byoc-setup.XXXXXX)"
mock_pgid="" dev_pgid=""
stop_group() { # <pgid>
  [[ -n "$1" ]] || return 0
  kill -TERM -- "-$1" 2>/dev/null || true
  for _ in $(seq 1 20); do
    ps -axo pgid= | awk -v g="$1" '$1==g{found=1} END{exit !found}' || break
    sleep 1
  done
  kill -KILL -- "-$1" 2>/dev/null || true
}
cleanup() {
  stop_group "$dev_pgid"
  stop_group "$mock_pgid"
  rm -rf "$temp_root"
}
trap cleanup EXIT

echo "guide: ${guide#$repo_root/} (blob $(git hash-object "$guide" | cut -c1-10)); node $(node -v); npm --before=$bound"
python3 "$extractor" "$guide" >"$temp_root/blocks.json"
# block title=<file>|starts=<prefix>|contains=<text>: the first VISIBLE fenced
# block with that title, or whose body starts with / contains that text.
block() {
  python3 - "$temp_root/blocks.json" "$1" <<'PY'
import json, sys
blocks, want = json.load(open(sys.argv[1]))["visible"], sys.argv[2]
kind, _, key = want.partition("=")
for b in blocks:
    if b["kind"] != "code":
        continue
    if (kind == "title" and b["title"] == key) or (kind == "starts" and b["body"].startswith(key)) or (kind == "contains" and key in b["body"]):
        sys.stdout.write(b["body"]); break
else:
    sys.exit(f"no visible block matching {want}")
PY
}
wait_ok() { # <pgid> -> sets status, i
  status=""
  for i in $(seq 1 180); do
    status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/ok" || true)"
    [[ "$status" == 200 ]] && break
    kill -0 "$1" 2>/dev/null || break
    sleep 1
  done
}

visible_path() {
  echo "=============== phase: visible-path ($(date -u +%FT%TZ))"
  python3 - "$temp_root/blocks.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
def label(b):
    if b["kind"] == "snippet":
        a = b["attrs"]
        return f"<Snippet {a.get('file') or a.get('region')}>"
    first = b["body"].splitlines()[0] if b["body"].strip() else ""
    return f"{b['title'] or '(untitled)'}: {first[:60]}"
print(f"visible to a TypeScript reader ({len(d['visible'])}):")
for b in d["visible"]:
    print("  ", label(b))
print(f"in a TypeScript tab but hidden from that reader ({len(d['hidden_typescript'])}):")
for b in d["hidden_typescript"]:
    print("  ", label(b))
titles = {b.get("title") for b in d["visible"] if b["kind"] == "code"}
bodies = [b["body"] for b in d["visible"] if b["kind"] == "code"]
need = {
    "agent code (src/agent.ts)": "src/agent.ts" in titles,
    "graph registration (langgraph.json)": "langgraph.json" in titles,
    "runtime route (app/api/copilotkit/route.ts)": "app/api/copilotkit/route.ts" in titles,
    "agent start command (langgraph-cli dev)": any("@langchain/langgraph-cli dev" in s for s in bodies),
}
for k, v in need.items():
    print(f"   {'present' if v else 'MISSING'}: {k}")
sys.exit(0 if all(need.values()) else 1)
PY
}

showcase_callout() {
  echo "=============== phase: showcase-callout ($(date -u +%FT%TZ))"
  local cmds work integration_root log ok=1
  cmds="$(block 'starts=git clone --depth 1')"; echo "$cmds" | sed 's/^/# guide: /'
  work="$temp_root/clone"; mkdir -p "$work"
  # "git clone ... && cd CopilotKit/showcase/integrations/langgraph-typescript": a clone-equivalent copy.
  # The integration's `_shared` is a symlink to the sibling `../_shared`
  # (c3f876bf73), so a clone's view of it needs that directory too: copy the
  # tracked files under every in-repo directory a symlink in the integration
  # points to.
  local paths=(showcase/integrations/langgraph-typescript) link target
  while IFS= read -r link; do
    target="$(cd "$(dirname "$repo_root/$link")" && cd "$(readlink "$repo_root/$link")" 2>/dev/null && pwd -P || true)"
    [[ -n "$target" && "$target" == "$repo_root"/* ]] || continue
    target="${target#$repo_root/}"
    [[ "$target" == showcase/integrations/langgraph-typescript* ]] && continue
    [[ -n "$(cd "$repo_root" && git ls-files "$target" | head -1)" ]] && paths+=("$target") && echo "symlink $link -> $target: copied"
  done < <(cd "$repo_root" && git ls-files -s showcase/integrations/langgraph-typescript | awk '$1=="120000"{print $4}')
  (cd "$repo_root" && git ls-files -co --exclude-standard -z "${paths[@]}") |
    (cd "$repo_root" && tar --null -T - -cf -) | tar -C "$work" -xf -
  integration_root="$work/showcase/integrations/langgraph-typescript"
  cd "$integration_root"
  echo "copied $(find . -type f | wc -l | tr -d ' ') files; node_modules present: $(test -e node_modules && echo yes || echo no); .langgraph_api present: $(test -e src/agent/.langgraph_api && echo yes || echo no)"
  echo '$ cp .env.example .env'; cp .env.example .env
  echo '# "Set OPENAI_API_KEY in .env": placeholder (no model request in this phase)'
  sed -i '' 's/^OPENAI_API_KEY=.*/OPENAI_API_KEY=sk-placeholder-not-used/' .env
  echo '$ cd src/agent && npm ci'; cd src/agent
  npm ci --no-audit --no-fund 2>&1 | grep -E '^added|ERR' || true
  npm ls --depth=0 @copilotkit/sdk-js @langchain/core @langchain/langgraph @langchain/langgraph-api @langchain/langgraph-cli @langchain/langgraph-sdk @langchain/openai langchain 2>/dev/null | tail -n +2 || true
  ./node_modules/.bin/tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck graph.ts
  echo "strict graph.ts typecheck: pass"
  echo '$ npm run dev'
  log="$temp_root/callout-dev.log"
  perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' npm run dev >"$log" 2>&1 </dev/null &
  dev_pgid=$!
  wait_ok "$dev_pgid"
  echo "GET http://localhost:$port/ok -> ${status:-none} after ${i}s; registered graphs: $(grep -c 'Registering graph with id' "$log" || true)"
  if [[ "$status" == 200 ]]; then
    curl -s -X POST "http://localhost:$port/assistants/search" -H 'content-type: application/json' -d '{"limit":100}' |
      node -e '
        const list = JSON.parse(require("fs").readFileSync(0, "utf8"));
        (async () => {
          let good = 0;
          for (const a of list) {
            const r = await fetch(`http://localhost:'"$port"'/assistants/${a.assistant_id}/graph`);
            if (r.ok) good++; else console.log(`  ${a.graph_id} ${r.status} ${(await r.text()).slice(0, 200)}`);
          }
          console.log(`GET /assistants/<id>/graph: ${good}/${list.length} return 200`);
          process.exit(good === list.length ? 0 : 1);
        })();' && ok=0
  else
    sed 's/\x1b\[[0-9;]*m//g' "$log" | tail -20
  fi
  stop_group "$dev_pgid"; dev_pgid=""
  echo "port $port after stop: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free)"
  return $ok
}

existing_agent() {
  echo "=============== phase: existing-agent ($(date -u +%FT%TZ))"
  local work="$temp_root/byo" cmd agent_id prompt log run_rc
  mkdir -p "$work" && cd "$work"
  mkdir -p "$temp_root/fixtures"
  cat >"$temp_root/fixtures/quickstart.json" <<'JSON'
{
  "fixtures": [
    {
      "_comment": "The quickstart's first suggested prompt, answered as plain text.",
      "match": { "userMessage": "tell me a joke" },
      "response": { "content": "Why do programmers prefer dark mode? Because light attracts bugs." }
    }
  ]
}
JSON
  perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$llmock" --port "$mock_port" --host 127.0.0.1 \
    --strict --validate-on-load --fixtures "$temp_root/fixtures" >"$temp_root/aimock.log" 2>&1 </dev/null &
  mock_pgid=$!
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$mock_port/__aimock/journal" && break; sleep 1; done
  echo "scratch AIMock on $mock_port: $(head -1 "$temp_root/aimock.log")"

  echo "--- Initialize your agent project"
  cmd="$(block 'starts=mkdir my-agent')"; echo "$cmd" | sed 's/^/$ /'
  eval "$cmd" >/dev/null                         # mkdir my-agent; cd my-agent; npm init -y
  echo "--- Install LangGraph"
  cmd="$(block 'starts=npm install @langchain/')"; echo "$cmd" | sed 's/^/$ /'
  eval "$cmd" 2>&1 | grep -E '^added|ERR' || true
  echo "resolved: $(npm ls --depth=0 2>/dev/null | tail -n +2 | tr -d '\n' | tr -s ' ')"
  echo "--- Expose your agent via AG-UI"
  mkdir -p src
  block 'title=src/agent.ts' >src/agent.ts
  block 'title=langgraph.json' >langgraph.json
  echo "wrote src/agent.ts ($(wc -l <src/agent.ts | tr -d ' ') lines) and langgraph.json from the guide: $(node -p 'JSON.stringify(require("./langgraph.json").graphs)')"
  echo "--- Configure your environment (the guide's own placeholder key)"
  block 'title=.env' | tee .env | sed 's/^/.env: /'
  echo "--- Create your frontend (scaffold not reproduced: npm init -y stands in for create-next-app)"
  block 'starts=npx create-next-app' | sed 's/^/# guide: /'
  mkdir -p frontend && cd frontend && npm init -y >/dev/null
  echo "--- Install CopilotKit packages"
  cmd="$(block 'starts=npm install @copilotkit')"; echo "$cmd" | sed 's/^/$ /'
  eval "$cmd" 2>&1 | grep -E '^added|ERR' || true
  echo "top-level: @copilotkit/runtime $(node -p 'require("@copilotkit/runtime/package.json").version'), @ag-ui/client $(node -p 'require("@ag-ui/client/package.json").version'); @ag-ui/core copies: $(npm ls @ag-ui/core --all 2>/dev/null | grep -oE '@ag-ui/core@[0-9][^ ]*' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  echo "--- Setup Copilot Runtime (the guide's LangSmith route.ts, with the no-Intelligence callout applied)"
  mkdir -p app/api/copilotkit
  block 'title=app/api/copilotkit/route.ts' >app/api/copilotkit/route.ts
  python3 - app/api/copilotkit/route.ts app/api/copilotkit/route.local.ts <<'PY'
import re, sys
src = open(sys.argv[1]).read()
assert "LangGraphAgent" in src, "the visible route is not the LangSmith (LangGraphAgent) route"
out, n1 = re.subn(r"\n[ \t]*intelligence: new CopilotKitIntelligence\(\{.*?\}\),", "", src, flags=re.S)
out, n2 = re.subn(r"\n[ \t]*// Local single-user setup[^\n]*\n[ \t]*identifyUser: \(\) => \(\{.*?\}\),", "", out, flags=re.S)
out, n3 = re.subn(r"\n[ \t]*CopilotKitIntelligence,", "", out)
assert (n1, n2, n3) == (1, 1, 1), (n1, n2, n3)
assert "intelligence" not in out and "identifyUser" not in out
open(sys.argv[2], "w").write(out)
PY
  diff -u app/api/copilotkit/route.ts app/api/copilotkit/route.local.ts | tail -n +3 || true
  agent_id="$(block 'title=app/providers.tsx' | sed -n 's/.*agent="\([^"]*\)".*/\1/p' | head -1)"
  echo "provider agent: $agent_id"

  echo "--- Start your agent"
  cmd="$(block 'contains=npx @langchain/langgraph-cli dev')"; echo "$cmd" | sed 's/^/$ /'
  log="$temp_root/agent-dev.log"
  OPENAI_BASE_URL="http://127.0.0.1:$mock_port/v1" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
    bash -c "$cmd" >"$log" 2>&1 </dev/null &
  dev_pgid=$!
  wait_ok "$dev_pgid"
  echo "GET http://localhost:$port/ok -> ${status:-none} after ${i}s"
  echo "listeners: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1"/"$9}' | sort -u | tr '\n' ' ')"
  if [[ "$status" != 200 ]]; then
    sed 's/\x1b\[[0-9;]*m//g' "$log" | tail -30
    stop_group "$dev_pgid"; dev_pgid=""
    return 1
  fi

  echo "--- Start chatting: one run through the route"
  prompt="$(python3 - "$guide" <<'PY'
import re, sys
t = open(sys.argv[1]).read()
s = t[t.index("Start chatting"):]
print(re.search(r"```\s*\n\s*(.+?)\s*\n\s*```", s).group(1))
PY
)"
  set +e
  "$tsx" "$runner" app/api/copilotkit/route.local.ts "$agent_id" "$prompt"
  run_rc=$?
  set -e
  echo "--- scratch AIMock journal for this run"
  curl -s "http://127.0.0.1:$mock_port/__aimock/journal" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    r = e.get("response") or {}
    b = e.get("body") or {}
    print(" ", e["path"], b.get("model"), (r.get("fixture") or {}).get("match"), r.get("status"))'
  echo "--- agent server log (ANSI stripped, per-graph lines collapsed, tail)"
  sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -v "graph_id:" | tail -12
  stop_group "$dev_pgid"; dev_pgid=""
  echo "port $port after stop: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free)"
  return $run_rc
}

rc=0
for phase in "${phases[@]}"; do
  fn="${phase//-/_}"
  set +e
  # A phase runs in a subshell, which does not inherit the EXIT trap, so it
  # stops the agent and scratch AIMock it started itself.
  (trap 'stop_group "$dev_pgid"; stop_group "$mock_pgid"' EXIT; set -e; "$fn")
  p_rc=$?
  set -e
  if [[ $p_rc -eq 0 ]]; then echo "RESULT $phase: PASS"; else echo "RESULT $phase: FAIL (exit $p_rc)"; rc=1; fi
done
exit "$rc"
