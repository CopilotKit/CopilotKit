#!/usr/bin/env bash
# Boot reproduction of the LangGraph quickstart's bring-your-own Python path
# (/langgraph/quickstart, "Use an existing agent" -> Python tab). Run from the
# repository root. Modelled on reproduce-lgts-byoc-setup.sh.
#
# * Every command and file comes from the guide itself:
#   extract-lgp-quickstart-python.py pulls the Python tab's fenced blocks out
#   of quickstart.mdx in document order (annotation comments removed, as the
#   rendered page shows them). Nothing is transcribed by hand.
# * Both deployment tabs run, each in a fresh `uv init` project in its own
#   temp directory: LangSmith (`npx @langchain/langgraph-cli dev`) and FastAPI
#   (`uv run main.py`).
# * The agent is started with the guide's own start block. Its first line,
#   `cd ..`, leaves the frontend directory; the frontend steps are not
#   reproduced here, so that line is skipped and the command runs in the agent
#   directory, which is where the guide says to run it.
# * Readiness is the server's own health endpoint: LangSmith `GET /ok`,
#   FastAPI `GET /health` (registered by add_langgraph_fastapi_endpoint).
#   Then the registered graph is listed and drawn (LangSmith) or the health
#   body is printed (FastAPI). No model request is made; the documented
#   OPENAI_API_KEY step is satisfied with a placeholder.
# * Deviations, all environment-only: UV_EXCLUDE_NEWER (default 24 h before
#   2026-09-23T23:00Z, the audit's publish-age floor) bounds what uv resolves;
#   LANGSMITH_TRACING=false, LANGGRAPH_CLI_NO_ANALYTICS=1 and DO_NOT_TRACK=1
#   keep the run from reporting anywhere.
#
# Usage: reproduce-lgp-byoc-setup.sh [LangSmith|FastAPI ...] (default: both)
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
guide="$repo_root/showcase/shell-docs/src/content/docs/integrations/langgraph/quickstart.mdx"
extractor="$repo_root/tasks/docs-feature-audit/extract-lgp-quickstart-python.py"
port=8123
tabs=("$@")
[[ ${#tabs[@]} -eq 0 ]] && tabs=(LangSmith FastAPI)

export UV_EXCLUDE_NEWER="${UV_EXCLUDE_NEWER:-2026-09-22T23:00:00Z}"
export LANGSMITH_TRACING=false LANGGRAPH_CLI_NO_ANALYTICS=1 DO_NOT_TRACK=1

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $port is already in use; refusing to start" >&2
  exit 2
fi

temp_root="$(mktemp -d /private/tmp/lgp-byoc-setup.XXXXXX)"
dev_pgid=""
stop_server() {
  if [[ -n "$dev_pgid" ]]; then
    kill -TERM -- "-$dev_pgid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      ps -axo pgid= | awk -v g="$dev_pgid" '$1==g{found=1} END{exit !found}' || break
      sleep 1
    done
    kill -KILL -- "-$dev_pgid" 2>/dev/null || true
    dev_pgid=""
  fi
}
cleanup() {
  stop_server
  rm -rf "$temp_root"
}
trap cleanup EXIT

python3 "$extractor" "$guide" >"$temp_root/blocks.json"
# block <tab> title=<file>|starts=<prefix>: the first fenced block visible in
# <tab> (its deployment tab is <tab> or "both") with that title or whose body
# starts with that prefix.
block() {
  python3 - "$temp_root/blocks.json" "$1" "$2" <<'PY'
import json, sys
blocks, tab, want = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
kind, _, key = want.partition("=")
for b in blocks:
    if b["tab"] not in (tab, "both"):
        continue
    if kind == "title" and b["title"] == key or kind == "starts" and b["body"].startswith(key):
        sys.stdout.write(b["body"]); break
else:
    sys.exit(f"no {tab} block matching {want}")
PY
}

run_tab() {
  local tab="$1" work="$temp_root/$1" status="" i=0 health_path
  trap stop_server EXIT   # runs in a subshell, which does not inherit the EXIT trap
  mkdir -p "$work" && cd "$work"
  echo "=============== $tab tab ($(date -u +%FT%TZ))"

  echo "--- Initialize your agent project"
  local init; init="$(block "$tab" 'starts=uv init')"; echo "$init" | sed 's/^/$ /'
  eval "$init"                                   # uv init my-agent; cd my-agent
  echo "--- Install LangGraph"
  local add; add="$(block "$tab" 'starts=uv add langgraph ')"; echo "$add" | sed 's/^/$ /'
  eval "$add"

  echo "--- Expose your agent via AG-UI ($tab)"
  if [[ "$tab" == LangSmith ]]; then
    block "$tab" 'title=main.py' >main.py
    local touch_cmd; touch_cmd="$(block "$tab" 'starts=touch langgraph.json')"; echo "$ $touch_cmd"
    eval "$touch_cmd"
    block "$tab" 'title=langgraph.json' >langgraph.json
    echo "wrote main.py ($(wc -l <main.py | tr -d ' ') lines) and langgraph.json from the guide"
  else
    local add2; add2="$(block "$tab" 'starts=uv add ag-ui-langgraph')"; echo "$add2" | sed 's/^/$ /'
    eval "$add2"
    block "$tab" 'title=main.py' >main.py
    echo "wrote main.py ($(wc -l <main.py | tr -d ' ') lines) from the guide"
  fi

  echo "--- Configure your environment (placeholder key)"
  block "$tab" 'title=.env' | sed 's/^OPENAI_API_KEY=.*/OPENAI_API_KEY=sk-placeholder-not-used/' >.env
  cat .env

  echo "--- resolved project dependencies (uv tree --depth 1)"
  uv tree --depth 1 2>/dev/null || true

  echo "--- Start your agent"
  local start; start="$(block "$tab" "starts=cd ..")"
  echo "$start" | sed 's/^/# guide: /'
  start="$(echo "$start" | grep -v '^cd \.\.$')"
  echo "\$ $start   (in $(pwd))"
  local log="$work/server.log"
  perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' bash -c "$start" >"$log" 2>&1 </dev/null &
  dev_pgid=$!
  if [[ "$tab" == LangSmith ]]; then health_path=/ok; else health_path=/health; fi
  for i in $(seq 1 300); do
    status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port$health_path" || true)"
    [[ "$status" == 200 ]] && break
    kill -0 "$dev_pgid" 2>/dev/null || break
    sleep 1
  done
  echo "GET http://localhost:$port$health_path -> ${status:-none} after ${i}s"
  echo "GET http://127.0.0.1:$port$health_path -> $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$health_path" || true)"
  echo "listeners: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1"/"$9}' | sort -u | tr '\n' ' ')"
  echo "--- server log (ANSI stripped, first 60 lines)"
  sed 's/\x1b\[[0-9;]*m//g' "$log" | head -60 || true

  if [[ "$status" == 200 ]]; then
    if [[ "$tab" == LangSmith ]]; then
      echo "--- GET /info"; curl -s "http://localhost:$port/info"; echo
      echo "--- registered graphs and their structure (GET /assistants/<id>/graph)"
      curl -s -X POST "http://localhost:$port/assistants/search" -H 'content-type: application/json' \
        -d '{"limit":100}' | python3 -c '
import json, sys, urllib.request
for a in json.load(sys.stdin):
    with urllib.request.urlopen(f"http://localhost:'"$port"'/assistants/{a["assistant_id"]}/graph") as r:
        g = json.load(r)
    print(a["graph_id"], r.status, "nodes=" + ",".join(n["id"] for n in g["nodes"]))'
    else
      echo "--- GET /health body"; curl -s "http://localhost:$port/health"; echo
    fi
  fi
  stop_server
  echo "port $port after stop: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free)"
  [[ "$status" == 200 ]]
}

rc=0
for tab in "${tabs[@]}"; do
  # Not in a `||` list, so errexit stays active inside the subshell.
  set +e
  (set -e; run_tab "$tab")
  tab_rc=$?
  set -e
  if [[ $tab_rc -eq 0 ]]; then echo "RESULT $tab: PASS"; else echo "RESULT $tab: FAIL (exit $tab_rc)"; rc=1; fi
done
exit "$rc"
