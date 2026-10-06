#!/bin/bash
# Stack control for the 2026-10-06 LangGraph TypeScript requalification.
# Same AIMock command/flags and stack command/environment as
# lgts-aimock-20260923b.log / lgts-dev-stack-20260923b.log; the dev script now
# runs langgraph-cli@1.5.2. Each process is started in its own process group
# (set -m) and stopped with SIGTERM to that group.
#
# usage: lgts-stack-20261006.sh <cmd> [args]
#   aimock-start <log> | aimock-stop | stack-start <log> | stack-stop <log>
#   prewarm <log> <demo,demo,...|all> | journal-reset | journal-dump <file>
#   rss-start <log> | rss-stop | ports
set -u
R=/Users/tylerslaton/.codex/worktrees/3715/CopilotKit
I=$R/showcase/integrations/langgraph-typescript
STATE=/private/tmp/claude-501/-Users-tylerslaton-Code-CopilotKit/46e242f6-1b34-4976-b132-d4b1ececf87d/scratchpad/lgts/state
mkdir -p "$STATE"
export PATH=/Users/tylerslaton/.nvm/versions/node/v22.16.0/bin:$PATH
UI_PORT=3101
API_ROUTES="/api/copilotkit /api/copilotkit-a2ui-fixed-schema /api/copilotkit-a2ui-recovery /api/copilotkit-agent-config /api/copilotkit-auth /api/copilotkit-beautiful-chat /api/copilotkit-declarative-gen-ui /api/copilotkit-declarative-hashbrown /api/copilotkit-declarative-json-render /api/copilotkit-mcp-apps /api/copilotkit-multimodal /api/copilotkit-ogui /api/copilotkit-voice /api/debug /api/health"

add_root() { echo "$1" >> "$STATE/roots"; }

case "$1" in
aimock-start)
  log=$2
  cd "$R"
  {
    echo "# AIMock (fixture-only, strict, strict turn-index), same command as lgts-aimock-20260923b.log; no --record/--proxy-only/--provider-* so no request can leave the mock."
    echo "\$ AIMOCK_STRICT_TURN_INDEX=1 nice -n 10 showcase/scripts/node_modules/.bin/llmock --port 4410 --host 127.0.0.1 --strict --validate-on-load --chunk-size 8 --latency 60 --fixtures showcase/aimock/shared --fixtures showcase/aimock/d4 --fixtures showcase/aimock/d5-recorded --fixtures showcase/aimock/d6"
    echo "# @copilotkit/aimock $(node -p 'require("./showcase/scripts/node_modules/@copilotkit/aimock/package.json").version'), node $(node -v), HEAD $(git rev-parse --short HEAD), started $(date -u)"
  } > "$log"
  set -m
  AIMOCK_STRICT_TURN_INDEX=1 nice -n 10 showcase/scripts/node_modules/.bin/llmock --port 4410 --host 127.0.0.1 --strict --validate-on-load --chunk-size 8 --latency 60 --fixtures showcase/aimock/shared --fixtures showcase/aimock/d4 --fixtures showcase/aimock/d5-recorded --fixtures showcase/aimock/d6 >> "$log" 2>&1 &
  echo $! > "$STATE/aimock.pid"; add_root $!
  for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:4410/__aimock/journal && break; sleep 1; done
  echo "aimock pid $(cat "$STATE/aimock.pid") up after ${i}s"; grep -m1 "Loaded" "$log"
  ;;
aimock-stop)
  pid=$(cat "$STATE/aimock.pid"); kill -TERM -- -"$pid" 2>/dev/null; sleep 2
  kill -0 -- -"$pid" 2>/dev/null && echo "aimock group $pid still alive" || echo "aimock group $pid stopped"
  ;;
stack-start)
  log=$2
  cd "$I"
  rm -rf .next
  {
    echo "# LGTS stack via the integration's documented default dev command (package.json scripts.dev = concurrently \"next dev --turbopack\" + langgraph-cli@1.5.2 dev --port 8123), same environment as lgts-dev-stack-20260923b.log. .next removed first."
    echo "\$ cd showcase/integrations/langgraph-typescript && PORT=$UI_PORT NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 LANGSMITH_TRACING=false LANGGRAPH_CLI_NO_ANALYTICS=1 OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=${DIAG_OPENAI_BASE_URL:-http://127.0.0.1:4410/v1} AIMOCK_URL=http://127.0.0.1:4410 LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123 nice -n 10 npm run dev"
    echo "# node $(node -v), npm $(npm -v), HEAD $(git rev-parse --short HEAD), started $(date -u)"
  } > "$log"
  set -m
  PORT=$UI_PORT NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 LANGSMITH_TRACING=false LANGGRAPH_CLI_NO_ANALYTICS=1 OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=${DIAG_OPENAI_BASE_URL:-http://127.0.0.1:4410/v1} AIMOCK_URL=http://127.0.0.1:4410 LANGGRAPH_DEPLOYMENT_URL=http://localhost:8123 nice -n 10 npm run dev >> "$log" 2>&1 &
  echo $! > "$STATE/stack.pid"; add_root $!
  t0=$(date +%s)
  for i in $(seq 1 240); do
    a=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://localhost:8123/ok)
    u=$(curl -s -o /dev/null -w '%{http_code}' -m 30 http://localhost:$UI_PORT/api/health)
    [ "$a" = 200 ] && [ "$u" = 200 ] && break
    sleep 1
  done
  echo "stack pid $(cat "$STATE/stack.pid"): agent /ok=$a ui /api/health=$u after $(( $(date +%s) - t0 ))s"
  n=$(curl -s -X POST -H 'content-type: application/json' -d '{"limit":100}' http://localhost:8123/assistants/search | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log("?")}})')
  echo "assistants registered: $n"
  ;;
stack-stop)
  pid=$(cat "$STATE/stack.pid"); kill -TERM -- -"$pid" 2>/dev/null; sleep 3
  kill -0 -- -"$pid" 2>/dev/null && { echo "stack group $pid still alive, SIGKILL"; kill -KILL -- -"$pid" 2>/dev/null; }
  echo "# stopped $(date -u) (SIGTERM to process group $pid)" >> "$2"
  echo "stack group $pid stopped"
  ;;
prewarm)
  log=$2; demos=$3
  if [ "$demos" = all ]; then demos=$(ls "$I/src/app/demos" | grep -vE '^(_shared|layout.tsx)$' | tr '\n' ','); fi
  {
    echo "# Sequential pre-warm (one GET at a time): demo pages [$demos] and every API route except /api/smoke. $(date -u)"
    for d in ${demos//,/ }; do echo "/demos/$d $(curl -s -o /dev/null -w '%{http_code} %{time_total}s' -m 120 http://localhost:$UI_PORT/demos/$d)"; done
    for a in $API_ROUTES; do echo "$a $(curl -s -o /dev/null -w '%{http_code} %{time_total}s' -m 120 http://localhost:$UI_PORT$a)"; done
    echo "# done $(date -u)"
  } > "$log" 2>&1
  awk '{print $2}' "$log" | grep -E '^[0-9]{3}$' | sort | uniq -c | tr '\n' ' '; echo
  ;;
journal-reset)
  curl -s -X POST http://127.0.0.1:4410/__aimock/reset/journal; echo
  ;;
journal-dump)
  curl -s http://127.0.0.1:4410/__aimock/journal > "$2"
  node -e 'const j=require(process.argv[1]);const c={};for(const e of j){const k=(e.response?.status??"?")+"";c[k]=(c[k]||0)+1}console.log(j.length+" requests, status counts "+JSON.stringify(c))' "$2"
  ;;
rss-start)
  : > "$STATE/rss.stop.unused"; rm -f "$STATE/rss.stop"
  nohup bash "$R/tasks/docs-feature-audit/lgts-rss-sampler-20261006.sh" "$STATE/roots" "$2" "$STATE/rss.stop" "$STATE/runner.pid" > /dev/null 2>&1 &
  echo $! > "$STATE/rss.pid"; echo "sampler pid $!"
  ;;
rss-stop)
  touch "$STATE/rss.stop"; sleep 6; kill -0 "$(cat "$STATE/rss.pid")" 2>/dev/null && echo "sampler still running" || echo "sampler stopped"
  ;;
d6)
  # d6 <log> <runner args...>: the run-local-d6.mts command from
  # lgts-runtime-matrix-20260923b.md, with --demos/--demo as given.
  log=$2; shift 2
  cd "$R"
  {
    echo "\$ AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-typescript $*"
    echo "# node $(node -v), HEAD $(git rev-parse --short HEAD), load $(sysctl -n vm.loadavg | awk '{print $2}'), started $(date -u +%FT%TZ)"
  } > "$log"
  AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts langgraph-typescript "$@" >> "$log" 2>&1 &
  rp=$!; echo $rp > "$STATE/runner.pid"; add_root $rp
  wait $rp; rc=$?
  echo "# exit=$rc finished $(date -u +%FT%TZ)" >> "$log"
  echo "runner exit=$rc"
  ;;
ports)
  for p in 3000 $UI_PORT 4410 4411 8123 8124 2024; do echo "port $p: $(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"; done
  ;;
esac
