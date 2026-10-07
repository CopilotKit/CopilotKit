#!/usr/bin/env bash
# Reproduction of the Built-in Agent quickstart (shell-docs' ROOT_FRAMEWORK, so
# its authored guide is the page served at the root /quickstart; the
# /built-in-agent/* URLs redirect there). The "byoc" in the name follows the
# other integrations' scripts (reproduce-{adk,lgp,strands}-byoc-setup.sh); the
# Built-in Agent has no bring-your-own option: its quickstart IS the in-process
# BuiltInAgent path. Run from the repository root.
#
# * What the reader sees: extract-bia-quickstart.py reads
#   showcase/shell-docs/src/content/docs/integrations/built-in-agent/quickstart.mdx,
#   simulates the docs Tabs component (package-manager = npm) and the
#   <FrontendOnly> filter (frontend = react, the default), and lists the fenced
#   blocks in document order with annotation comments removed. Nothing is
#   transcribed by hand.
# * Completeness check: visible + hidden blocks must equal the page's raw
#   fenced-block count, and every hidden block must sit in a non-npm
#   package-manager tab, so a markup change that hides a block from the
#   extractor fails the run instead of silently shrinking it.
# * Phase "visible-path": the visible path must hold the create-next-app
#   block, the `npm install @copilotkit/...` block, the .env block, the
#   [[...slug]] route.ts registering a BuiltInAgent as `default`, the provider,
#   the layout, the page, the npm start block and the "Start chatting" prompts.
# * Phase "quickstart" (per variant): every visible step, in a fresh temp
#   directory, with the guide's own commands and files:
#     - its create-next-app block, run as written (CI=1 and stdin from
#       /dev/null, so create-next-app takes its defaults instead of prompting);
#     - its npm install block, plus any variant extras;
#     - its .env file, verbatim (its own placeholder key);
#     - route.ts, providers.tsx, layout.tsx and page.tsx written verbatim into
#       the scaffold's app/ directory (layout.tsx replaces the scaffold's);
#     - its start block (`npm run dev`), verbatim, with PORT=3118 in the
#       environment: the audit never touches port 3000;
#     - then the "Start chatting" step through the guide's runtime route, the
#       way the guide's provider talks to it (multi-route, agent `default`):
#       GET / (the page renders), GET /api/copilotkit/info, and one
#       POST /api/copilotkit/agent/default/run with the guide's first prompt,
#       "Can you tell me a joke?", read to the end of the SSE stream.
# * The model call goes to a scratch strict AIMock on :4412 holding one
#   fixture for that prompt, through the runtime's own OPENAI_BASE_URL
#   support (BuiltInAgent's "openai:" models pass process.env.OPENAI_BASE_URL
#   to createOpenAI). No request reaches OpenAI.
# * Prerequisite check: the guide's "Node.js X+" line against the Node used.
# * Other deviations, all environment-only: npm_config_before (default
#   2026-10-05T21:00Z) bounds what npx and npm resolve, so
#   `create-next-app@latest` is the latest release published before the bound.
#
# Usage: reproduce-bia-byoc-setup.sh [variant ...]   (default: as-written)
#   as-written              the guide's install line, unchanged
#   npm:<spec>[,<spec>...]  extra `npm install <spec>` after the guide's line
#   none                    the visible-path check only
#   GUIDE=<file> points the script at another copy of the guide.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
guide="${GUIDE:-$repo_root/showcase/shell-docs/src/content/docs/integrations/built-in-agent/quickstart.mdx}"
extractor="$repo_root/tasks/docs-feature-audit/extract-bia-quickstart.py"
llmock="$repo_root/showcase/scripts/node_modules/.bin/llmock"
port=3118 mock_port=4412
bound="${NPM_BEFORE:-2026-10-05T21:00:00Z}"
export npm_config_before="$bound"
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
export DO_NOT_TRACK=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true CI=1
variants=("$@")
[[ ${#variants[@]} -eq 0 ]] && variants=(as-written)

for p in $port $mock_port; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p is already in use; refusing to start" >&2
    exit 2
  fi
done

temp_root="$(mktemp -d /private/tmp/bia-byoc-setup.XXXXXX)"
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
print(f"extractor: {len(vis)} visible + {len(hid)} hidden = {len(vis) + len(hid)} blocks; raw MDX page: {raw} fenced blocks")
bad = [b for b in hid if not any(t in ("pnpm", "yarn", "bun") for t in b["tabs"])]
for b in vis:
    print(f"  visible {b['index']:2} {b['lang'] or '(none)':9} {(b['title'] or '-'):42} {b['step']}{'  [callout]' if b['callout'] else ''}")
for b in hid:
    print(f"  hidden  {b['index']:2} {b['lang'] or '(none)':9} {(b['title'] or '-'):42} {b['step']} tabs={b['tabs']} frontend={b['frontend']}")
if len(vis) + len(hid) != raw:
    sys.exit(f"extractor accounts for {len(vis) + len(hid)} of {raw} fenced blocks")
if bad:
    sys.exit(f"hidden blocks outside non-npm package-manager tabs: {[b['step'] for b in bad]}")
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
for want in 'starts=npx create-next-app' 'starts=npm install @copilotkit' 'title=.env' \
  'title=app/api/copilotkit/[[...slug]]/route.ts' 'title=app/providers.tsx' 'title=app/layout.tsx' \
  'title=app/page.tsx' 'step=Start the development server' 'step=Start chatting'; do
  if body="$(block "$want" 2>&1)"; then echo "found $want: $(echo "$body" | head -1)"; else echo "MISSING $want"; vp_rc=1; fi
done
route_ts="$(block 'title=app/api/copilotkit/[[...slug]]/route.ts')"
grep -q 'new BuiltInAgent' <<<"$route_ts" && grep -q 'default: builtInAgent' <<<"$route_ts" \
  || { echo "route.ts does not register a BuiltInAgent as default"; vp_rc=1; }
model="$(sed -n 's/.*model: "\([^"]*\)".*/\1/p' <<<"$route_ts" | head -1)"
grep -q 'runtimeUrl="/api/copilotkit"' <<<"$(block 'title=app/providers.tsx')" || { echo "provider runtimeUrl is not /api/copilotkit"; vp_rc=1; }
grep -q 'useSingleEndpoint' <<<"$(block 'title=app/providers.tsx')" && { echo "provider is single-endpoint; the run below assumes multi-route"; vp_rc=1; }
grep -qx 'npm run dev' <<<"$(block 'step=Start the development server')" || { echo "npm start block is not 'npm run dev'"; vp_rc=1; }
prompt="$(block 'step=Start chatting' | head -1)"
echo "route model: $model; prompt from the guide's Start chatting step: \"$prompt\""
if [[ $vp_rc -eq 0 ]]; then echo "RESULT visible-path: PASS"; else echo "RESULT visible-path: FAIL"; fi

echo "=============== prerequisites"
min_node="$(sed -n 's/^- Node\.js \([0-9][0-9]*\)+.*/\1/p' "$guide" | head -1)"
echo "guide: \"$(grep -m1 '^- Node.js' "$guide")\"; node $(node -v), npm $(npm -v)"
if [[ -n "$min_node" && "$(node -p 'process.versions.node.split(".")[0]')" -ge "$min_node" ]]; then
  echo "RESULT prerequisites: PASS"; pr_rc=0
else
  echo "RESULT prerequisites: FAIL"; pr_rc=1
fi

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
echo "scratch AIMock on $mock_port: $(grep -m1 Loaded "$temp_root/aimock.log" || head -1 "$temp_root/aimock.log")"
echo "bound: npm --before=$bound"

run_variant() {
  local variant="$1" extra_npm="" work status="" i=0
  case "$variant" in
    as-written) ;;
    npm:*) extra_npm="${variant#npm:}" ;;
    *) echo "unknown variant $variant" >&2; return 2 ;;
  esac
  work="$temp_root/$(echo "$variant" | tr -c 'A-Za-z0-9.\n' '_')"
  mkdir -p "$work" && cd "$work"
  echo "=============== quickstart, variant: $variant ($(date -u +%FT%TZ))"

  echo "--- Create your frontend"
  local scaffold; scaffold="$(block 'starts=npx create-next-app')"; echo "$scaffold" | sed 's/^/$ /'
  eval "$scaffold" </dev/null >"$work/create-next-app.log" 2>&1   # create-next-app; cd my-copilot-app
  grep -E '^Using |Creating a new|Success|Installing|Error' "$work/create-next-app.log" | head -8 || true
  local app_dir="app"; [[ -d src/app ]] && app_dir="src/app"
  echo "scaffold: next $(node -p 'require("next/package.json").version'), react $(node -p 'require("react/package.json").version'), app dir $app_dir/, files: $(ls "$app_dir" | tr '\n' ' ')"

  echo "--- Install CopilotKit packages"
  local npm_add; npm_add="$(block 'starts=npm install @copilotkit')"; echo "$npm_add" | sed 's/^/$ /'
  eval "$npm_add" 2>&1 | grep -E '^added|^changed|ERR' || true
  if [[ -n "$extra_npm" ]]; then
    echo "\$ npm install ${extra_npm//,/ }   (variant)"
    npm install ${extra_npm//,/ } 2>&1 | grep -E '^added|^changed|ERR' || true
  fi
  echo "package.json dependencies: $(node -p 'JSON.stringify(require("./package.json").dependencies)')"
  echo "installed @ag-ui/core copies:   $(npm ls @ag-ui/core --all 2>/dev/null | grep -oE '@ag-ui/core@[0-9][^ ]*' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  echo "installed @ag-ui/client copies: $(npm ls @ag-ui/client --all 2>/dev/null | grep -oE '@ag-ui/client@[0-9][^ ]*' | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
  echo "top-level: @copilotkit/runtime $(node -p 'require("@copilotkit/runtime/package.json").version'), @copilotkit/react-core $(node -p 'require("@copilotkit/react-core/package.json").version')"

  echo "--- Configure your environment"
  block 'title=.env' >.env
  echo "wrote .env from the guide: $(sed 's/=.*/=<guide placeholder>/' .env)"

  echo "--- Setup Copilot Runtime / Configure CopilotKit Provider / Add the chat interface"
  mkdir -p "$app_dir/api/copilotkit/[[...slug]]"
  block 'title=app/api/copilotkit/[[...slug]]/route.ts' >"$app_dir/api/copilotkit/[[...slug]]/route.ts"
  block 'title=app/providers.tsx' >"$app_dir/providers.tsx"
  block 'title=app/layout.tsx' >"$app_dir/layout.tsx"
  block 'title=app/page.tsx' >"$app_dir/page.tsx"
  echo "wrote $app_dir/api/copilotkit/[[...slug]]/route.ts, $app_dir/providers.tsx, $app_dir/layout.tsx (replaces the scaffold's), $app_dir/page.tsx (replaces the scaffold's), verbatim"

  echo "--- Start the development server (the guide's npm block, verbatim; PORT=$port in the environment)"
  local start; start="$(block 'step=Start the development server')"; echo "$start" | sed 's/^/$ /'
  PORT=$port OPENAI_BASE_URL="http://127.0.0.1:$mock_port/v1" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
    bash -c "$start" >"$work/server.log" 2>&1 </dev/null &
  dev_pgid=$!
  for i in $(seq 1 180); do
    status="$(curl -s -o /dev/null -w '%{http_code}' -m 120 "http://localhost:$port/" || true)"
    [[ "$status" == 200 ]] && break
    kill -0 "$dev_pgid" 2>/dev/null || break
    sleep 1
  done
  echo "GET http://localhost:$port/ -> ${status:-none} after ${i}s; page contains 'Your App': $(curl -s "http://localhost:$port/" | grep -q 'Your App' && echo yes || echo no)"

  echo "--- Start chatting: the provider's transport against the guide's route"
  local info; info="$(curl -s -m 60 "http://localhost:$port/api/copilotkit/info")"
  echo "GET /api/copilotkit/info: $(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print("version", d.get("version"), "agents", sorted(d.get("agents", {})))' "$info" 2>&1 | head -1)"
  curl -s -X POST "http://127.0.0.1:$mock_port/__aimock/reset/journal" >/dev/null
  local body; body="$(python3 -c 'import json,sys,uuid; print(json.dumps({"threadId":str(uuid.uuid4()),"runId":str(uuid.uuid4()),"state":{},"messages":[{"id":str(uuid.uuid4()),"role":"user","content":sys.argv[1]}],"tools":[],"context":[],"forwardedProps":{}}))' "$prompt")"
  local code; code="$(curl -s -N -m 120 -o "$work/run.sse" -w '%{http_code}' -H 'content-type: application/json' -H 'accept: text/event-stream' \
    -X POST "http://localhost:$port/api/copilotkit/agent/default/run" --data "$body")"
  echo "POST /api/copilotkit/agent/default/run -> $code"
  local run_rc=0
  python3 - "$work/run.sse" <<'PY' || run_rc=$?
import json, sys
types, text, err = [], "", None
for line in open(sys.argv[1]):
    if not line.startswith("data:"):
        continue
    e = json.loads(line[5:]); types.append(e.get("type"))
    if e.get("type") in ("TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"): text += e.get("delta") or ""
    if e.get("type") == "RUN_ERROR": err = e.get("message")
print("events:", " ".join(types)); print("assistant text:", repr(text))
if err: print("RUN_ERROR:", err)
sys.exit(0 if types and types[-1] == "RUN_FINISHED" and text else 1)
PY
  echo "--- scratch AIMock journal for this run"
  curl -s "http://127.0.0.1:$mock_port/__aimock/journal" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    r = e.get("response") or {}
    print(" ", e["method"], e["path"].split("?")[0], (e.get("body") or {}).get("model"), (r.get("fixture") or {}).get("match"), r.get("status"))'
  echo "--- dev server log (tail, ANSI stripped)"
  tail -12 "$work/server.log" | sed 's/\x1b\[[0-9;]*m//g'
  stop_group "$dev_pgid"; dev_pgid=""
  echo "port $port after stop: $(lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free)"
  [[ "$status" == 200 && "$code" == 200 && $run_rc -eq 0 ]]
}

rc=$((vp_rc | pr_rc))
for variant in "${variants[@]}"; do
  [[ "$variant" == none ]] && continue
  set +e
  (set -e; run_variant "$variant")
  v_rc=$?
  set -e
  if [[ $v_rc -eq 0 ]]; then echo "RESULT quickstart $variant: PASS"; else echo "RESULT quickstart $variant: FAIL (exit $v_rc)"; rc=1; fi
done
exit "$rc"
