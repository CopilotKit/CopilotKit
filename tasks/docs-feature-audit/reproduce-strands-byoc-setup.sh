#!/usr/bin/env bash
# Reproduction of the AWS Strands quickstart's bring-your-own Python path
# (/strands/quickstart, "Use an existing agent"), as a Python reader sees it.
# Run from the repository root. Modelled on reproduce-adk-byoc-setup.sh and
# reproduce-lgp-byoc-setup.sh (2026-10-06).
#
# * What the reader sees: extract-strands-quickstart.py reads quickstart.mdx in
#   the folder `strands` resolves to through getDocsFolder() (aws-strands/),
#   simulates the docs Tabs component (language_strands_agent = Python, which
#   the page pre-selects on /strands/*; package-manager = npm) and lists the
#   option's fenced blocks in document order, annotation comments removed.
#   Nothing is transcribed by hand.
# * Completeness check: visible + hidden blocks must equal the option's raw
#   fenced-block count, and every hidden block must sit in a TypeScript or
#   non-npm tab, so a markup change that hides a Python block from the
#   extractor fails the run instead of silently shrinking it.
# * Phase "visible-path": the Python reader's visible path must hold the
#   `uv init` and `uv add` lines, the OpenAI main.py (outside the "Using
#   Anthropic instead" callout), a multi-route `[[...slug]]` HttpAgent route,
#   the provider's agent name and the `uv run main.py` start block.
# * Phase "existing-agent" (per variant): the visible steps, run in a fresh
#   temp directory with the guide's own commands and files: `uv init my-agent`
#   and `cd my-agent`, its `uv add` line, its `export OPENAI_API_KEY=...` line
#   (its own placeholder value), its main.py, `npx create-next-app@latest
#   frontend` + `cd frontend` (`npm init -y` in frontend/ stands in for the
#   scaffold), its frontend `npm install` line, its route.ts, and its start
#   block run verbatim from frontend/ (its `cd ..` returns to the agent
#   directory). The React files (providers.tsx, layout.tsx, page.tsx) and the
#   Intelligence step (`npx copilotkit@latest project select`) are not
#   reproduced, and the route runs with the guide's "Running without the
#   Intelligence Platform?" callout applied (drop `intelligence` and
#   `identifyUser`). strands-byoc-runtime-run.mts then imports that route file
#   and drives it the way the guide's provider does (`useSingleEndpoint=
#   {false}`, its `agent=`): GET /api/copilotkit/info, then one
#   POST /api/copilotkit/agent/<agent>/run with the guide's "Please tell me a
#   joke." prompt from its "Start chatting" step.
# * The model call goes to a scratch strict AIMock on :4411 holding one
#   fixture for that prompt, through the OpenAI SDK's own OPENAI_BASE_URL
#   environment variable (the guide's OpenAIModel passes only api_key). No
#   request reaches OpenAI.
# * Prerequisite check first: the guide's own "Python X.Y+" line is read from
#   its Prerequisites list, and its `uv add` line is resolved for a `uv init`
#   project whose requires-python is ">=X.Y".
# * Other deviations, all environment-only: UV_EXCLUDE_NEWER (default
#   2026-10-05T21:00Z) and npm's --before bound what uv and npm resolve. The
#   npm bound must not be earlier than 2026-10-05T14:21Z, when the guide's
#   pinned @ag-ui/client@1.0.2 was published.
#
# Usage: reproduce-strands-byoc-setup.sh [variant ...]   (default: as-written)
#   as-written              the guide's install lines, unchanged
#   py:<req>[,<req>...]     extra `uv add <req>` after the guide's line
#   npm:<spec>[,<spec>...]  extra `npm install <spec>` after the guide's line
#   none                    the prerequisite and visible-path checks only
#   GUIDE=<file> points the script at another copy of the guide.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
guide="${GUIDE:-$repo_root/showcase/shell-docs/src/content/docs/integrations/aws-strands/quickstart.mdx}"
extractor="$repo_root/tasks/docs-feature-audit/extract-strands-quickstart.py"
runner="$repo_root/tasks/docs-feature-audit/strands-byoc-runtime-run.mts"
tsx="$repo_root/node_modules/.bin/tsx"
llmock="$repo_root/showcase/scripts/node_modules/.bin/llmock"
port=8000 mock_port=4411
bound="${UV_EXCLUDE_NEWER:-2026-10-05T21:00:00Z}"
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

temp_root="$(mktemp -d /private/tmp/strands-byoc-setup.XXXXXX)"
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
python3 - "$temp_root/blocks.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
vis, hid, raw = d["visible"], d["hidden"], d["raw_fenced_blocks"]
print(f"extractor: {len(vis)} visible + {len(hid)} hidden = {len(vis) + len(hid)} blocks; raw MDX option: {raw} fenced blocks")
bad = [b for b in hid if not any(t in ("TypeScript", "pnpm", "yarn", "bun") for t in b["tabs"])]
for b in vis:
    print(f"  visible {b['index']:2} {b['lang']:9} {(b['title'] or '-'):42} {b['step']}{'  [callout]' if b['callout'] else ''}")
if len(vis) + len(hid) != raw:
    sys.exit(f"extractor accounts for {len(vis) + len(hid)} of {raw} fenced blocks")
if bad:
    sys.exit(f"hidden blocks outside TypeScript/non-npm tabs: {[b['step'] for b in bad]}")
PY
# block title=<file>|starts=<prefix>|step=<heading>: the first visible block
# outside a callout with that title, whose body starts with that prefix, or
# under that step heading.
block() {
  python3 - "$temp_root/blocks.json" "$1" <<'PY'
import json, sys
blocks, want = json.load(open(sys.argv[1]))["visible"], sys.argv[2]
kind, _, key = want.partition("=")
for b in blocks:
    if b["callout"]:
        continue
    if (kind == "title" and b["title"] == key) or (kind == "starts" and b["body"].startswith(key)) or (kind == "step" and b["step"] == key):
        sys.stdout.write(b["body"]); break
else:
    sys.exit(f"no visible non-callout block matching {want}")
PY
}

echo "=============== visible-path ($(date -u +%FT%TZ))"
vp_rc=0
for want in 'starts=uv init my-agent' 'starts=uv add ag-ui-strands' 'starts=export OPENAI_API_KEY' 'title=main.py' \
  'title=app/api/copilotkit/[[...slug]]/route.ts' 'title=app/providers.tsx' 'step=Start your agent'; do
  if body="$(block "$want" 2>&1)"; then echo "found $want: $(echo "$body" | head -1)"; else echo "MISSING $want"; vp_rc=1; fi
done
main_py="$(block 'title=main.py')"
grep -q 'OpenAIModel' <<<"$main_py" && grep -q 'create_strands_app' <<<"$main_py" || { echo "main.py is not the OpenAI create_strands_app agent"; vp_rc=1; }
route_ts="$(block 'title=app/api/copilotkit/[[...slug]]/route.ts')"
grep -q 'new HttpAgent' <<<"$route_ts" || { echo "route.ts has no HttpAgent"; vp_rc=1; }
agent_id="$(block 'title=app/providers.tsx' | sed -n 's/.*agent="\([^"]*\)".*/\1/p' | head -1)"
grep -q "useSingleEndpoint={false}" <<<"$(block 'title=app/providers.tsx')" || { echo "provider is not multi-route"; vp_rc=1; }
grep -q "^ *$agent_id: new HttpAgent" <<<"$route_ts" || { echo "route.ts does not register the provider's agent '$agent_id'"; vp_rc=1; }
grep -q 'uv run main.py' <<<"$(block 'step=Start your agent')" || { echo "start block does not run uv run main.py"; vp_rc=1; }
prompt="$(python3 - "$guide" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
chat = text[text.index("### 🎉 Start chatting!"):]
for body in re.findall(r"```\s*\n(.*?)\n\s*```", chat, flags=re.S):
    if "joke" in body:
        print(body.strip()); break
PY
)"
echo "provider agent: $agent_id; prompt from the guide's Start chatting step: \"$prompt\""
if [[ $vp_rc -eq 0 ]]; then echo "RESULT visible-path: PASS"; else echo "RESULT visible-path: FAIL"; fi

mkdir -p "$temp_root/fixtures"
cat >"$temp_root/fixtures/quickstart.json" <<'JSON'
{
  "fixtures": [
    {
      "_comment": "The quickstart's suggested joke prompt, answered as plain text.",
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
  echo "=============== existing-agent, variant: $variant ($(date -u +%FT%TZ))"

  echo "--- Initialize your agent project"
  local init; init="$(block 'starts=uv init my-agent')"; echo "$init" | sed 's/^/$ /'
  eval "$init" >/dev/null 2>&1                  # uv init my-agent; cd my-agent
  echo "uv init project: $(grep '^requires-python' pyproject.toml), .python-version $(cat .python-version 2>/dev/null)"
  echo "--- Install Strands with AG-UI"
  local add; add="$(block 'starts=uv add ag-ui-strands')"; echo "$add" | sed 's/^/$ /'
  eval "$add" 2>&1 | grep -E '^ \+ (ag-ui|strands|openai|fastapi|uvicorn|starlette)' || true
  if [[ -n "$extra_py" ]]; then
    echo "\$ uv add ${extra_py//,/ }   (variant)"
    uv add ${extra_py//,/ } 2>&1 | grep -E '^ [-+] ' || true
  fi
  echo "resolved: $(uv pip list 2>/dev/null | awk '$1 ~ /^(ag-ui-strands|ag-ui-protocol|ag-ui-a2ui-toolkit|strands-agents|openai|fastapi|uvicorn)$/ {printf "%s %s, ", $1, $2}') python $(uv run python -c 'import platform; print(platform.python_version())')"
  echo "--- Configure your environment"
  local envline; envline="$(block 'starts=export OPENAI_API_KEY')"; echo "$envline" | sed 's/^/$ /'
  eval "$envline"                               # the guide's own placeholder value
  echo "--- Expose your agent via AG-UI"
  block 'title=main.py' >main.py
  echo "wrote main.py ($(wc -l <main.py | tr -d ' ') lines) from the guide (replaces uv init's hello-world main.py)"

  echo "--- Create your frontend (scaffold not reproduced: npm init -y in frontend/ stands in for create-next-app)"
  local scaffold; scaffold="$(block 'starts=npx create-next-app')"; echo "$scaffold" | sed 's/^/# guide: /'
  mkdir -p frontend && cd frontend
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

  echo "--- Start your agent (the guide's block, verbatim, from frontend/)"
  local start; start="$(block 'step=Start your agent')"; echo "$start" | sed 's/^/$ /'
  OPENAI_BASE_URL="http://127.0.0.1:$mock_port/v1" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
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

  echo "--- Start chatting: one run through the route"
  curl -s -X POST "http://127.0.0.1:$mock_port/__aimock/reset/journal" >/dev/null
  set +e
  "$tsx" "$runner" "app/api/copilotkit/[[...slug]]/route.local.ts" "$agent_id" "$prompt"
  local run_rc=$?
  set -e
  echo "--- scratch AIMock journal for this run"
  curl -s "http://127.0.0.1:$mock_port/__aimock/journal" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    r = e.get("response") or {}
    msgs = (e.get("body") or {}).get("messages") or []
    print(" ", e["path"].split("?")[0], (e.get("body") or {}).get("model"), ",".join(m.get("role", "?") for m in msgs), (r.get("fixture") or {}).get("match"), r.get("status"))'
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
  eval "$(block 'starts=uv init my-agent')" >/dev/null 2>&1   # uv init my-agent; cd my-agent
  sed -i '' "s/^requires-python = .*/requires-python = \">=$min\"/" pyproject.toml
  echo "requires-python set to the stated minimum: $(grep '^requires-python' pyproject.toml)"
  local add; add="$(block 'starts=uv add ag-ui-strands')"; echo "$add" | sed 's/^/$ /'
  set +e
  eval "$add" >"$work/uv-add.log" 2>&1
  local add_rc=$?
  set -e
  if [[ $add_rc -eq 0 ]]; then
    echo "resolves for Python >=$min: $(python3 -c '
import tomllib
lock = tomllib.load(open("uv.lock", "rb"))
want = ("ag-ui-strands", "ag-ui-protocol", "strands-agents", "openai", "fastapi")
print(", ".join(f"{p['"'"'name'"'"']} {p['"'"'version'"'"']}" for p in lock["package"] if p["name"] in want))')"
  else
    echo "does NOT resolve for Python >=$min (exit $add_rc):"
    sed -n '1,6p' "$work/uv-add.log"
  fi
  return $add_rc
}

rc=$vp_rc
set +e
(set -e; prereq_check)
p_rc=$?
set -e
if [[ $p_rc -eq 0 ]]; then echo "RESULT prerequisites: PASS"; else echo "RESULT prerequisites: FAIL (exit $p_rc)"; rc=1; fi
for variant in "${variants[@]}"; do
  [[ "$variant" == none ]] && continue
  set +e
  (set -e; run_variant "$variant")
  v_rc=$?
  set -e
  if [[ $v_rc -eq 0 ]]; then echo "RESULT existing-agent $variant: PASS"; else echo "RESULT existing-agent $variant: FAIL (exit $v_rc)"; rc=1; fi
done
exit "$rc"
