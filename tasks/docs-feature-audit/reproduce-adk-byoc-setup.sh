#!/usr/bin/env bash
# Reproduction of the ADK quickstart's bring-your-own path (/adk/quickstart,
# "Use an existing agent"). Run from the repository root. Modelled on
# reproduce-lgp-byoc-setup.sh.
#
# * Every command and file comes from the guide itself:
#   extract-adk-quickstart.py pulls the option's fenced blocks out of
#   quickstart.mdx (the page google-adk resolves to via getDocsFolder()) in
#   document order, annotation comments removed as the rendered page shows
#   them. Nothing is transcribed by hand.
# * Agent: `uv init my-agent`, the guide's `uv add` line, its
#   `export GOOGLE_API_KEY=...` line (its own placeholder value), its main.py,
#   and its start block `uv run main.py`, in a fresh temp directory.
#   Readiness is FastAPI's own GET /openapi.json (the guide's app has no
#   health route); the registered routes are printed.
# * Frontend: the guide's `npm install` line runs in a fresh temp project and
#   its `app/api/copilotkit/[[...slug]]/route.ts` block is written there. The
#   `npx create-next-app@latest` scaffold, the Intelligence steps
#   (`npx copilotkit@latest project select`, CPK_INTELLIGENCE_API_KEY) and the
#   React files are not reproduced: `npm init -y` stands in for the scaffold,
#   and the route runs with the guide's "Running without the Intelligence
#   Platform?" callout applied (drop `intelligence` and `identifyUser`).
#   adk-byoc-runtime-run.mts then imports that route file and drives it the
#   way the guide's provider does (`useSingleEndpoint={false}`,
#   `agent="my_agent"`): GET /api/copilotkit/info, then one
#   POST /api/copilotkit/agent/my_agent/run with the guide's first suggested
#   prompt, "Can you tell me a joke?".
# * The model call goes to a scratch strict AIMock on :4411 holding one
#   fixture for that prompt, through google-genai's own GOOGLE_GEMINI_BASE_URL
#   environment variable. No request reaches Gemini.
# * Other deviations, all environment-only: UV_EXCLUDE_NEWER and npm's
#   --before (default 2026-09-22T23:00Z, >= 24 h before the audit run) bound
#   what uv and npm resolve.
# * Prerequisite check first: the guide's own "Python X.Y+" line is read from
#   its Prerequisites list, and the guide's `uv add` line is resolved for a
#   `uv init` project whose requires-python is ">=X.Y" (uv locks for every
#   Python in that range, so the stated minimum must resolve; no X.Y
#   interpreter is needed). GUIDE=<file> points the script at another copy of
#   the guide, e.g. the pre-fix one.
#
# Usage: reproduce-adk-byoc-setup.sh [variant ...]   (default: as-written)
#   as-written              the guide's install lines, unchanged
#   py:<req>[,<req>...]     extra `uv add <req>` after the guide's line
#   npm:<spec>[,<spec>...]  extra `npm install <spec>` after the guide's line
#   none                    the prerequisite check only
#   e.g. reproduce-adk-byoc-setup.sh as-written "py:ag-ui-protocol==0.1.22" "npm:@ag-ui/client@0.0.59"
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
guide="${GUIDE:-$repo_root/showcase/shell-docs/src/content/docs/integrations/adk/quickstart.mdx}"
extractor="$repo_root/tasks/docs-feature-audit/extract-adk-quickstart.py"
runner="$repo_root/tasks/docs-feature-audit/adk-byoc-runtime-run.mts"
tsx="$repo_root/node_modules/.bin/tsx"
llmock="$repo_root/showcase/scripts/node_modules/.bin/llmock"
port=8000 mock_port=4411
bound="${UV_EXCLUDE_NEWER:-2026-09-22T23:00:00Z}"
export UV_EXCLUDE_NEWER="$bound" npm_config_before="$bound"
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false DO_NOT_TRACK=1
variants=("$@")
[[ ${#variants[@]} -eq 0 ]] && variants=(as-written)

for p in $port $mock_port; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p is already in use; refusing to start" >&2
    exit 2
  fi
done

temp_root="$(mktemp -d /private/tmp/adk-byoc-setup.XXXXXX)"
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

python3 "$extractor" "$guide" >"$temp_root/blocks.json"
# block title=<file>|starts=<prefix>: the first fenced block with that title
# or whose body starts with that prefix.
block() {
  python3 - "$temp_root/blocks.json" "$1" <<'PY'
import json, sys
blocks, want = json.load(open(sys.argv[1])), sys.argv[2]
kind, _, key = want.partition("=")
for b in blocks:
    if kind == "title" and b["title"] == key or kind == "starts" and b["body"].startswith(key):
        sys.stdout.write(b["body"]); break
else:
    sys.exit(f"no block matching {want}")
PY
}

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
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$mock_port/__aimock/health" && break; sleep 1; done
echo "scratch AIMock on $mock_port: $(head -1 "$temp_root/aimock.log")"
echo "bound: UV_EXCLUDE_NEWER=npm --before=$bound"

run_variant() {
  local variant="$1" extra_py="" extra_npm="" work status="" i=0
  case "$variant" in
    as-written) ;;
    py:*) extra_py="${variant#py:}" ;;
    npm:*) extra_npm="${variant#npm:}" ;;
    *) echo "unknown variant $variant" >&2; return 2 ;;
  esac
  work="$temp_root/$(echo "$variant" | tr -c 'A-Za-z0-9.\n' '_')"
  mkdir -p "$work" && cd "$work"
  echo "=============== variant: $variant ($(date -u +%FT%TZ))"

  echo "--- Initialize your agent project"
  local init; init="$(block 'starts=uv init')"; echo "$init" | sed 's/^/$ /'
  eval "$init" >/dev/null 2>&1                  # uv init my-agent; cd my-agent
  echo "--- Install ADK with AG-UI"
  local add; add="$(block 'starts=uv add ag-ui-adk')"; echo "$add" | sed 's/^/$ /'
  eval "$add" 2>&1 | grep -E '^ \+ (ag-ui|a2ui|google-adk|google-genai|fastapi|uvicorn|starlette)' || true
  if [[ -n "$extra_py" ]]; then
    echo "\$ uv add ${extra_py//,/ }   (variant)"
    uv add ${extra_py//,/ } 2>&1 | grep -E '^ [-+] ' || true
  fi
  echo "resolved: $(uv pip list 2>/dev/null | awk '$1 ~ /^(ag-ui-adk|ag-ui-protocol|a2ui-agent-sdk|google-adk|google-genai|fastapi|uvicorn)$/ {printf "%s %s, ", $1, $2}')"
  echo "--- Configure your environment"
  local envline; envline="$(block 'starts=export GOOGLE_API_KEY')"; echo "$envline" | sed 's/^/$ /'
  eval "$envline"                               # the guide's own placeholder value
  echo "--- Expose your agent via AG-UI"
  block 'title=main.py' >main.py
  echo "wrote main.py ($(wc -l <main.py | tr -d ' ') lines) from the guide"

  echo "--- Start your agent"
  local start; start="$(block 'starts=uv run main.py')"; echo "$start" | sed 's/^/$ /'
  GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:$mock_port" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
    bash -c "$start" >"$work/server.log" 2>&1 </dev/null &
  dev_pgid=$!
  for i in $(seq 1 120); do
    status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/openapi.json" || true)"
    [[ "$status" == 200 ]] && break
    kill -0 "$dev_pgid" 2>/dev/null || break
    sleep 1
  done
  echo "GET http://localhost:$port/openapi.json -> ${status:-none} after ${i}s"
  echo "listeners: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1"/"$9}' | sort -u | tr '\n' ' ')"
  if [[ "$status" == 200 ]]; then
    curl -s "http://localhost:$port/openapi.json" | python3 -c '
import json, sys
paths = json.load(sys.stdin)["paths"]
print("routes:", ", ".join(f"{m.upper()} {p}" for p, ops in sorted(paths.items()) for m in ops))'
  fi

  echo "--- Create your frontend (scaffold not reproduced: npm init -y stands in for create-next-app)"
  block 'starts=npx create-next-app' | sed 's/^/# guide: /'
  mkdir -p "$work/my-copilot-app" && cd "$work/my-copilot-app"
  npm init -y >/dev/null
  echo "--- Install CopilotKit packages"
  local npm_add; npm_add="$(block 'starts=npm install @copilotkit')"; echo "$npm_add" | sed 's/^/$ /'
  eval "$npm_add" 2>&1 | grep -E '^added|ERR' || true
  if [[ -n "$extra_npm" ]]; then
    echo "\$ npm install ${extra_npm//,/ }   (variant)"
    npm install ${extra_npm//,/ } 2>&1 | grep -E '^added|^changed|ERR' || true
  fi
  echo "package.json dependencies: $(node -p 'JSON.stringify(require("./package.json").dependencies)')"
  echo "installed @ag-ui/client copies: $(npm ls @ag-ui/client --all 2>/dev/null | grep -oE '@ag-ui/client@[0-9][^ ]*' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  echo "installed @ag-ui/core copies:   $(npm ls @ag-ui/core --all 2>/dev/null | grep -oE '@ag-ui/core@[0-9][^ ]*' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  echo "top-level: @copilotkit/runtime $(node -p 'require("@copilotkit/runtime/package.json").version'), @ag-ui/client $(node -p 'require("@ag-ui/client/package.json").version')"

  echo "--- Setup Copilot Runtime (the guide's route.ts, with the no-Intelligence callout applied)"
  mkdir -p "app/api/copilotkit/[[...slug]]"
  block 'title=app/api/copilotkit/[[...slug]]/route.ts' >"app/api/copilotkit/[[...slug]]/route.ts"
  python3 - "app/api/copilotkit/[[...slug]]/route.ts" "app/api/copilotkit/[[...slug]]/route.local.ts" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
out, n1 = re.subn(r"\n[ \t]*intelligence: new CopilotKitIntelligence\(\{.*?\}\),", "", src, flags=re.S)
out, n2 = re.subn(r"\n[ \t]*// Local single-user setup[^\n]*\n[ \t]*identifyUser: \(\) => \(\{.*?\}\),", "", out, flags=re.S)
out, n3 = re.subn(r"\n[ \t]*CopilotKitIntelligence,", "", out)
assert (n1, n2, n3) == (1, 1, 1), (n1, n2, n3)
assert "intelligence" not in out and "identifyUser" not in out
open(sys.argv[2], "w").write(out)
PY
  diff -u "app/api/copilotkit/[[...slug]]/route.ts" "app/api/copilotkit/[[...slug]]/route.local.ts" | tail -n +3 || true

  echo "--- Start chatting: one run through the route"
  curl -s -X POST "http://127.0.0.1:$mock_port/__aimock/reset/journal" >/dev/null
  set +e
  "$tsx" "$runner" "app/api/copilotkit/[[...slug]]/route.local.ts" "$(block 'starts=Can you tell me a joke' | head -1)"
  local run_rc=$?
  set -e
  echo "--- scratch AIMock journal for this run"
  curl -s "http://127.0.0.1:$mock_port/__aimock/journal" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    r = e.get("response") or {}
    print(" ", e["path"].split("?")[0], (r.get("fixture") or {}).get("match"), r.get("status"))'
  echo "--- agent server log (tail, ANSI stripped)"
  tail -15 "$work/server.log" | sed 's/\x1b\[[0-9;]*m//g'
  stop_group "$dev_pgid"; dev_pgid=""
  echo "port $port after stop: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free)"
  [[ "$status" == 200 && $run_rc -eq 0 ]]
}

prereq_check() {
  local min work="$temp_root/prereq"
  min="$(sed -n 's/^- Python \([0-9][0-9]*\.[0-9][0-9]*\)+.*/\1/p' "$guide" | head -1)"
  echo "=============== prerequisites: the guide says \"$(grep -m1 '^- Python ' "$guide")\" ($(date -u +%FT%TZ))"
  [[ -n "$min" ]] || { echo "no 'Python X.Y+' prerequisite found"; return 1; }
  mkdir -p "$work" && cd "$work"
  eval "$(block 'starts=uv init')" >/dev/null 2>&1   # uv init my-agent; cd my-agent
  sed -i '' "s/^requires-python = .*/requires-python = \">=$min\"/" pyproject.toml
  echo "requires-python set to the stated minimum: $(grep '^requires-python' pyproject.toml)"
  local add; add="$(block 'starts=uv add ag-ui-adk')"; echo "$add" | sed 's/^/$ /'
  set +e
  eval "$add" >"$work/uv-add.log" 2>&1
  local add_rc=$?
  set -e
  if [[ $add_rc -eq 0 ]]; then
    echo "resolves for Python >=$min: $(python3 -c '
import sys, tomllib
lock = tomllib.load(open("uv.lock", "rb"))
want = ("ag-ui-adk", "ag-ui-protocol", "google-adk", "google-genai")
print(", ".join(f"{p['"'"'name'"'"']} {p['"'"'version'"'"']}" for p in lock["package"] if p["name"] in want))')"
  else
    echo "does NOT resolve for Python >=$min (exit $add_rc):"
    sed -n '1,6p' "$work/uv-add.log"
  fi
  return $add_rc
}

rc=0
set +e
(set -e; prereq_check)
p_rc=$?
set -e
if [[ $p_rc -eq 0 ]]; then echo "RESULT prerequisites: PASS"; else echo "RESULT prerequisites: FAIL (exit $p_rc)"; rc=1; fi
for variant in "${variants[@]}"; do
  [[ "$variant" == none ]] && continue          # prerequisite check only
  set +e
  (set -e; run_variant "$variant")
  v_rc=$?
  set -e
  if [[ $v_rc -eq 0 ]]; then echo "RESULT $variant: PASS"; else echo "RESULT $variant: FAIL (exit $v_rc)"; rc=1; fi
done
exit "$rc"
