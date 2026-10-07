#!/bin/bash
# Stack control for the 2026-10-06 Built-in Agent qualification.
# Derived from strands-stack-20261006.sh (itself from adk-stack-20261006.sh):
# the same AIMock command/flags as the LGTS/LGP/ADK/Strands 10-06 runs, and
# the integration's documented default `npm run dev` (package.json
# scripts.dev: next dev --turbopack). Built-in Agent has no separate agent
# server: the BuiltInAgent runs in-process in the Next.js route handlers, so
# there is no uvicorn half and no AGENT_URL. Each process is started in its
# own process group (set -m) and stopped with SIGTERM to that group. Each
# stack boot removes .next first.
# DIAG_OPENAI_BASE_URL points the in-process agent's OpenAI calls elsewhere
# (the scratch A2UI AIMock on :4411) for targeted checks only.
#
# usage: bia-stack-20261006.sh <cmd> [args]
#   aimock-start <log> | aimock-stop | stack-start <log> | stack-stop <log>
#   prewarm <log> <demo,demo,...|all> | journal-reset | journal-dump <file>
#   rss-start <log> | rss-stop | d6 <log> <runner args...> | ports
#   aimock2-start <log> <fixtures-dir> | aimock2-stop   (scratch strict AIMock on :4411)
set -u
R=/Users/tylerslaton/.codex/worktrees/3715/CopilotKit
I=$R/showcase/integrations/built-in-agent
SP=/private/tmp/claude-501/-Users-tylerslaton-Code-CopilotKit/46e242f6-1b34-4976-b132-d4b1ececf87d/scratchpad/bia
STATE=$SP/state
mkdir -p "$STATE"
export PATH=/Users/tylerslaton/.nvm/versions/node/v22.16.0/bin:$PATH
UI_PORT=3117
OPENAI_URL=${DIAG_OPENAI_BASE_URL:-http://127.0.0.1:4410/v1}
API_ROUTES="/api/copilotkit /api/copilotkit-a2ui-fixed-schema /api/copilotkit-a2ui-recovery /api/copilotkit-agent-config /api/copilotkit-auth /api/copilotkit-beautiful-chat /api/copilotkit-declarative-gen-ui /api/copilotkit-declarative-hashbrown /api/copilotkit-declarative-json-render /api/copilotkit-mcp-apps /api/copilotkit-multimodal /api/copilotkit-ogui /api/copilotkit-reasoning /api/copilotkit-voice /api/health"

add_root() { echo "$1" >> "$STATE/roots"; }

case "$1" in
aimock-start)
  log=$2
  cd "$R"
  {
    echo "# AIMock (fixture-only, strict, strict turn-index), same command as strands-aimock-20261006.log; no --record/--proxy-only/--provider-* so no request can leave the mock."
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
aimock2-start)
  log=$2; fx=$3
  cd "$R"
  {
    echo "# Scratch strict AIMock on :4411 for the generate_a2ui order check: only the fixtures in $fx; same flags as the Showcase AIMock."
    echo "\$ AIMOCK_STRICT_TURN_INDEX=1 nice -n 10 showcase/scripts/node_modules/.bin/llmock --port 4411 --host 127.0.0.1 --strict --validate-on-load --chunk-size 8 --latency 60 --fixtures $fx"
    echo "# HEAD $(git rev-parse --short HEAD), started $(date -u)"
  } > "$log"
  set -m
  AIMOCK_STRICT_TURN_INDEX=1 nice -n 10 showcase/scripts/node_modules/.bin/llmock --port 4411 --host 127.0.0.1 --strict --validate-on-load --chunk-size 8 --latency 60 --fixtures "$fx" >> "$log" 2>&1 &
  echo $! > "$STATE/aimock2.pid"; add_root $!
  for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:4411/__aimock/journal && break; sleep 1; done
  echo "scratch aimock pid $(cat "$STATE/aimock2.pid") up after ${i}s"; grep -m1 "Loaded" "$log"
  ;;
aimock2-stop)
  pid=$(cat "$STATE/aimock2.pid"); kill -TERM -- -"$pid" 2>/dev/null; sleep 2
  kill -0 -- -"$pid" 2>/dev/null && echo "scratch aimock group $pid still alive" || echo "scratch aimock group $pid stopped"
  ;;
stack-start)
  log=$2
  cd "$I"
  rm -rf .next
  {
    echo "# Built-in Agent stack via the integration's documented default dev command (package.json scripts.dev = $(node -p 'require("./package.json").scripts.dev')). In-process agent: no separate agent server. .next removed first."
    echo "\$ cd showcase/integrations/built-in-agent && PORT=$UI_PORT NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=$OPENAI_URL AIMOCK_URL=http://127.0.0.1:4410 nice -n 10 npm run dev"
    echo "# node $(node -v), npm $(npm -v), runtime $(node -p 'require("./node_modules/@copilotkit/runtime/package.json").version'), @tanstack/ai $(node -p 'require("./node_modules/@tanstack/ai/package.json").version'), HEAD $(git rev-parse --short HEAD), tree vs HEAD: $(git status --porcelain -- . | tr '\n' ' '), started $(date -u)"
  } > "$log"
  set -m
  PORT=$UI_PORT NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 OPENAI_API_KEY=sk-mock OPENAI_BASE_URL=$OPENAI_URL AIMOCK_URL=http://127.0.0.1:4410 nice -n 10 npm run dev >> "$log" 2>&1 &
  echo $! > "$STATE/stack.pid"; add_root $!
  t0=$(date +%s)
  for i in $(seq 1 240); do
    u=$(curl -s -o /dev/null -w '%{http_code}' -m 60 http://localhost:$UI_PORT/api/health)
    [ "$u" = 200 ] && break
    sleep 1
  done
  echo "stack pid $(cat "$STATE/stack.pid"): ui /api/health=$u after $(( $(date +%s) - t0 ))s"
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
    for d in ${demos//,/ }; do echo "/demos/$d $(curl -s -o /dev/null -w '%{http_code} %{time_total}s' -m 180 http://localhost:$UI_PORT/demos/$d)"; done
    for a in $API_ROUTES; do echo "$a $(curl -s -o /dev/null -w '%{http_code} %{time_total}s' -m 180 http://localhost:$UI_PORT$a)"; done
    echo "# done $(date -u)"
  } > "$log" 2>&1
  awk '{print $2}' "$log" | grep -E '^[0-9]{3}$' | sort | uniq -c | tr '\n' ' '; echo
  ;;
journal-reset)
  curl -s -X POST http://127.0.0.1:${3:-4410}/__aimock/reset/journal; echo
  ;;
journal-dump)
  curl -s http://127.0.0.1:${3:-4410}/__aimock/journal > "$2"
  node -e 'const j=require(process.argv[1]);const c={};for(const e of j){const k=(e.response?.status??"?")+"";c[k]=(c[k]||0)+1}console.log(j.length+" requests, status counts "+JSON.stringify(c))' "$2"
  ;;
rss-start)
  rm -f "$STATE/rss.stop"
  nohup bash "$R/tasks/docs-feature-audit/bia-rss-sampler-20261006.sh" "$STATE/roots" "$2" "$STATE/rss.stop" "$STATE/runner.pid" > /dev/null 2>&1 &
  echo $! > "$STATE/rss.pid"; echo "sampler pid $!"
  ;;
rss-stop)
  touch "$STATE/rss.stop"; sleep 6; kill -0 "$(cat "$STATE/rss.pid")" 2>/dev/null && echo "sampler still running" || echo "sampler stopped"
  ;;
d6)
  # d6 <log> <runner args...>: the run-local-d6.mts command from
  # strands-runtime-matrix-20261006.md, with --demos/--demo as given.
  log=$2; shift 2
  cd "$R"
  {
    echo "\$ AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts built-in-agent $*"
    echo "# node $(node -v), HEAD $(git rev-parse --short HEAD), load $(sysctl -n vm.loadavg | awk '{print $2}'), started $(date -u +%FT%TZ)"
  } > "$log"
  AIMOCK_URL_LOCAL=http://127.0.0.1:4410 AIMOCK_URL=http://127.0.0.1:4410 SHOWCASE_LOCAL=1 NEXT_TELEMETRY_DISABLED=1 COPILOTKIT_TELEMETRY_DISABLED=true nice -n 10 node_modules/.bin/tsx tasks/docs-feature-audit/run-local-d6.mts built-in-agent "$@" >> "$log" 2>&1 &
  rp=$!; echo $rp > "$STATE/runner.pid"; add_root $rp
  wait $rp; rc=$?
  echo "# exit=$rc finished $(date -u +%FT%TZ)" >> "$log"
  echo "runner exit=$rc"
  ;;
ports)
  for p in 3000 $UI_PORT 4410 4411 4412 8000; do echo "port $p: $(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"; done
  ;;
esac
