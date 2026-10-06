#!/usr/bin/env bash
# Reproduction of the LangGraph quickstart's bring-your-own Python path
# (/langgraph-python/quickstart, "Use an existing agent"), as a Python reader
# sees it, for both deployment tabs. Run from the repository root.
#
# Rewritten 2026-10-06 (the 2026-09-23 version is in git history). Its
# extractor stopped matching the guide after the 09-30 per-step language tabs
# and the 7256775c4c TypeScript restructure: it found only the `uv init`
# block, so both tabs failed at "Install LangGraph". Modelled on
# reproduce-lgts-byoc-setup.sh.
#
# * What the reader sees: extract-lgp-quickstart-python.py simulates the docs
#   Tabs component (one selection per groupId; Python pre-selected on
#   /langgraph-python/* and /langgraph-fastapi/*; the deployment tab given;
#   npm) and lists the fenced blocks that reader can see, in document order,
#   annotation comments removed. Nothing is transcribed by hand.
# * Phase "visible-path" (per tab): the visible path must contain the agent
#   install line(s), main.py (and langgraph.json on LangSmith), a runtime
#   route of the right shape (LangGraphAgent on LangSmith, HttpAgent on
#   FastAPI) and that tab's start command.
# * Phase "existing-agent" (per tab): the visible steps, run in a fresh temp
#   directory with the guide's own commands and files: `uv init my-agent` and
#   `cd my-agent`, its `uv add` line(s), its main.py (+ `touch langgraph.json`
#   and langgraph.json), its .env line (its own placeholder key),
#   `npx create-next-app@latest frontend` + `cd frontend` (npm init -y stands
#   in for the scaffold), its frontend `npm install` line, its route.ts, and
#   its start block run verbatim from frontend/ (its `cd ..` returns to the
#   agent directory). The React files and the Intelligence steps
#   (`npx copilotkit@latest project select`) are not reproduced, and the
#   route runs with the guide's "Running without the Intelligence Platform?"
#   callout applied (drop `intelligence` and `identifyUser`).
#   lgts-byoc-runtime-run.mts then imports that route file and drives it the
#   way the guide's provider does (`useSingleEndpoint`, its `agent=`): one
#   `info` call and one `agent/run` with the guide's first suggested prompt.
# * The model call goes to a scratch strict AIMock on :4411 holding one
#   fixture for that prompt, through the OpenAI SDK's own OPENAI_BASE_URL
#   environment variable. No request reaches OpenAI.
# * Other deviations, all environment-only: UV_EXCLUDE_NEWER (default
#   2026-10-05T21:00Z) and npm's --before (default 2026-10-05T12:00Z), both
#   >= 24 h before the audit run, bound what uv, npm and npx resolve;
#   LANGSMITH_TRACING=false, LANGGRAPH_CLI_NO_ANALYTICS=1 and DO_NOT_TRACK=1
#   keep the run from reporting anywhere.
#
# Usage: reproduce-lgp-byoc-setup.sh [LangSmith|FastAPI ...] (default: both)
#   GUIDE=<file> points the script at another copy of the guide.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
guide="${GUIDE:-$repo_root/showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx}"
extractor="$repo_root/tasks/docs-feature-audit/extract-lgp-quickstart-python.py"
runner="$repo_root/tasks/docs-feature-audit/lgts-byoc-runtime-run.mts"
tsx="$repo_root/node_modules/.bin/tsx"
llmock="$repo_root/showcase/scripts/node_modules/.bin/llmock"
port=8123 mock_port=4411
export UV_EXCLUDE_NEWER="${UV_EXCLUDE_NEWER:-2026-10-05T21:00:00Z}"
bound="${NPM_BEFORE:-2026-10-05T12:00:00Z}"
export npm_config_before="$bound" npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
export LANGSMITH_TRACING=false LANGGRAPH_CLI_NO_ANALYTICS=1 DO_NOT_TRACK=1 SCARF_ANALYTICS=false
tabs=("$@")
[[ ${#tabs[@]} -eq 0 ]] && tabs=(LangSmith FastAPI)

for p in $port $mock_port; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p is already in use; refusing to start" >&2
    exit 2
  fi
done

temp_root="$(mktemp -d /private/tmp/lgp-byoc-setup.XXXXXX)"
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

echo "guide: ${guide#$repo_root/} (blob $(git hash-object "$guide" | cut -c1-10)); node $(node -v); uv $(uv --version | cut -d' ' -f2); UV_EXCLUDE_NEWER=$UV_EXCLUDE_NEWER; npm --before=$bound"
for tab in "${tabs[@]}"; do
  python3 "$extractor" "$guide" "$tab" >"$temp_root/blocks-$tab.json"
done

# block <tab> title=<file>|starts=<prefix>|contains=<text>: the first VISIBLE
# fenced block for that deployment tab with that title, or whose body starts
# with / contains that text.
block() {
  python3 - "$temp_root/blocks-$1.json" "$2" <<'PY'
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

visible_path() { # <tab>
  echo "=============== $1 tab, phase: visible-path ($(date -u +%FT%TZ))"
  python3 - "$temp_root/blocks-$1.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
tab = d["deployment"]
def label(b):
    if b["kind"] == "snippet":
        a = b["attrs"]
        return f"<Snippet {a.get('file') or a.get('region')}>"
    first = b["body"].splitlines()[0] if b["body"].strip() else ""
    return f"{b['title'] or '(untitled)'}: {first[:60]}"
print(f"visible to a Python reader on the {tab} tab ({len(d['visible'])}):")
for b in d["visible"]:
    print("  ", label(b))
print(f"in a Python or {tab} tab but hidden from that reader ({len(d['hidden_python'])}; the other deployment tab's blocks):")
for b in d["hidden_python"]:
    print("  ", label(b))
code = [b for b in d["visible"] if b["kind"] == "code"]
titles = {b.get("title") for b in code}
bodies = [b["body"] for b in code]
route = next((b["body"] for b in code if b["title"] == "app/api/copilotkit/route.ts"), "")
need = {
    "agent install (uv add langgraph ...)": any(s.startswith("uv add langgraph ") for s in bodies),
    "agent code (main.py)": "main.py" in titles,
    "runtime route (app/api/copilotkit/route.ts)": bool(route),
}
if tab == "LangSmith":
    need["graph registration (langgraph.json)"] = "langgraph.json" in titles
    need["route uses LangGraphAgent"] = "LangGraphAgent" in route
    need["agent start command (langgraph-cli dev)"] = any("@langchain/langgraph-cli dev" in s for s in bodies)
else:
    need["FastAPI install (uv add ag-ui-langgraph ...)"] = any(s.startswith("uv add ag-ui-langgraph") for s in bodies)
    need["route uses HttpAgent"] = "HttpAgent" in route
    need["agent start command (uv run main.py)"] = any("uv run main.py" in s for s in bodies)
for k, v in need.items():
    print(f"   {'present' if v else 'MISSING'}: {k}")
sys.exit(0 if all(need.values()) else 1)
PY
}

existing_agent() { # <tab>
  local tab="$1" work="$temp_root/$1" cmd agent_id prompt log run_rc status="" i=0 health
  echo "=============== $tab tab, phase: existing-agent ($(date -u +%FT%TZ))"
  mkdir -p "$work" "$temp_root/fixtures-$tab" && cd "$work"
  cat >"$temp_root/fixtures-$tab/quickstart.json" <<'JSON'
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
    --strict --validate-on-load --fixtures "$temp_root/fixtures-$tab" >"$temp_root/aimock-$tab.log" 2>&1 </dev/null &
  mock_pgid=$!
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$mock_port/__aimock/journal" && break; sleep 1; done
  echo "scratch AIMock on $mock_port: $(head -1 "$temp_root/aimock-$tab.log")"

  echo "--- Initialize your agent project"
  cmd="$(block "$tab" 'starts=uv init')"; echo "$cmd" | sed 's/^/$ /'
  eval "$cmd" 2>&1                                 # uv init my-agent; cd my-agent
  echo "--- Install LangGraph"
  cmd="$(block "$tab" 'starts=uv add langgraph ')"; echo "$cmd" | sed 's/^/$ /'
  eval "$cmd" 2>&1 | grep -E '^(Resolved|Installed| \+ (langgraph|langchain|ag-ui|copilotkit|openai|fastapi|uvicorn)[ =])' || true
  echo "--- Expose your agent via AG-UI ($tab)"
  if [[ "$tab" == FastAPI ]]; then
    cmd="$(block "$tab" 'starts=uv add ag-ui-langgraph')"; echo "$cmd" | sed 's/^/$ /'
    eval "$cmd" 2>&1 | grep -E '^(Resolved|Installed| \+ (langgraph|langchain|ag-ui|copilotkit|openai|fastapi|uvicorn)[ =])' || true
    block "$tab" 'title=main.py' >main.py
    echo "wrote main.py ($(wc -l <main.py | tr -d ' ') lines) from the guide"
  else
    block "$tab" 'title=main.py' >main.py
    cmd="$(block "$tab" 'starts=touch langgraph.json')"; echo "$ $cmd"; eval "$cmd"
    block "$tab" 'title=langgraph.json' >langgraph.json
    echo "wrote main.py ($(wc -l <main.py | tr -d ' ') lines) and langgraph.json from the guide: $(python3 -c 'import json; print(json.load(open("langgraph.json"))["graphs"])')"
  fi
  echo "resolved: $(uv pip list 2>/dev/null | awk '$1 ~ /^(langgraph|langchain-core|langchain-openai|ag-ui-protocol|ag-ui-langgraph|copilotkit|fastapi|uvicorn)$/ {printf "%s %s, ", $1, $2}')python $(uv run python -c 'import platform; print(platform.python_version())' 2>/dev/null)"
  echo "--- Configure your environment (the guide's own placeholder key)"
  block "$tab" 'title=.env' | tee .env | sed 's/^/.env: /'
  echo "--- Create your frontend (scaffold not reproduced: npm init -y stands in for create-next-app)"
  cmd="$(block "$tab" 'starts=npx create-next-app')"; echo "$cmd" | sed 's/^/# guide: /'
  mkdir -p frontend && cd frontend && npm init -y >/dev/null
  echo "--- Install CopilotKit packages"
  cmd="$(block "$tab" 'starts=npm install @copilotkit')"; echo "$cmd" | sed 's/^/$ /'
  eval "$cmd" 2>&1 | grep -E '^added|ERR' || true
  echo "top-level: @copilotkit/runtime $(node -p 'require("@copilotkit/runtime/package.json").version'), @ag-ui/client $(node -p 'require("@ag-ui/client/package.json").version'); @ag-ui/core copies: $(npm ls @ag-ui/core --all 2>/dev/null | grep -oE '@ag-ui/core@[0-9][^ ]*' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  echo "--- Setup Copilot Runtime (the guide's $tab route.ts, with the no-Intelligence callout applied)"
  cmd="$(block "$tab" 'starts=mkdir -p app/api/copilotkit')"; echo "$cmd" | sed 's/^/$ /'; eval "$cmd"
  block "$tab" 'title=app/api/copilotkit/route.ts' >app/api/copilotkit/route.ts
  python3 - app/api/copilotkit/route.ts app/api/copilotkit/route.local.ts "$tab" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
want = "LangGraphAgent" if sys.argv[3] == "LangSmith" else "HttpAgent"
assert want in src, f"the visible route is not the {sys.argv[3]} ({want}) route"
out, n1 = re.subn(r"\n[ \t]*intelligence: new CopilotKitIntelligence\(\{.*?\}\),", "", src, flags=re.S)
out, n2 = re.subn(r"\n[ \t]*// Local single-user setup[^\n]*\n[ \t]*identifyUser: \(\) => \(\{.*?\}\),", "", out, flags=re.S)
out, n3 = re.subn(r"\n[ \t]*CopilotKitIntelligence,", "", out)
assert (n1, n2, n3) == (1, 1, 1), (n1, n2, n3)
assert "intelligence" not in out and "identifyUser" not in out
open(sys.argv[2], "w").write(out)
PY
  diff -u app/api/copilotkit/route.ts app/api/copilotkit/route.local.ts | tail -n +3 || true
  agent_id="$(block "$tab" 'title=app/providers.tsx' | sed -n 's/.*agent="\([^"]*\)".*/\1/p' | head -1)"
  echo "provider agent: $agent_id"

  echo "--- Start your agent (the guide's block, run verbatim from frontend/)"
  if [[ "$tab" == LangSmith ]]; then
    cmd="$(block "$tab" 'contains=npx @langchain/langgraph-cli dev')"; health=/ok
  else
    cmd="$(block "$tab" 'contains=uv run main.py')"; health=/health
  fi
  echo "$cmd" | sed 's/^/$ /'
  log="$temp_root/agent-$tab.log"
  OPENAI_BASE_URL="http://127.0.0.1:$mock_port/v1" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
    bash -c "$cmd" >"$log" 2>&1 </dev/null &
  dev_pgid=$!
  for i in $(seq 1 300); do
    status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port$health" || true)"
    [[ "$status" == 200 ]] && break
    kill -0 "$dev_pgid" 2>/dev/null || break
    sleep 1
  done
  echo "GET http://localhost:$port$health -> ${status:-none} after ${i}s"
  echo "listeners: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1"/"$9}' | sort -u | tr '\n' ' ')"
  if [[ "$status" != 200 ]]; then
    sed 's/\x1b\[[0-9;]*m//g' "$log" | tail -30
    stop_group "$dev_pgid"; dev_pgid=""
    return 1
  fi
  if [[ "$tab" == LangSmith ]]; then
    echo "GET /info: $(curl -s "http://localhost:$port/info")"
  else
    echo "GET /health: $(curl -s "http://localhost:$port/health")"
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
    print(" ", e["path"], b.get("model"), [m.get("role") for m in b.get("messages", [])], (r.get("fixture") or {}).get("match"), r.get("status"))'
  echo "--- agent server log (ANSI stripped, tail)"
  sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -vE "graph_id:|Importing graph" | tail -15
  stop_group "$dev_pgid"; dev_pgid=""
  stop_group "$mock_pgid"; mock_pgid=""
  echo "ports $port/$mock_port after stop: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free)/$(lsof -nP -iTCP:"$mock_port" -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free)"
  return $run_rc
}

rc=0
for tab in "${tabs[@]}"; do
  for phase in visible-path existing-agent; do
    fn="${phase//-/_}"
    set +e
    # A phase runs in a subshell, which does not inherit the EXIT trap, so it
    # stops the agent and scratch AIMock it started itself.
    (trap 'stop_group "$dev_pgid"; stop_group "$mock_pgid"' EXIT; set -e; "$fn" "$tab")
    p_rc=$?
    set -e
    if [[ $p_rc -eq 0 ]]; then echo "RESULT $tab $phase: PASS"; else echo "RESULT $tab $phase: FAIL (exit $p_rc)"; rc=1; fi
  done
done
exit "$rc"
