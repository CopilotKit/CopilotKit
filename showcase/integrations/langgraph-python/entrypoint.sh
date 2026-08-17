#!/bin/bash
set -e

# Shutdown traps. EXIT alone does NOT cover SIGTERM: an untrapped SIGTERM kills
# bash by signal and the EXIT trap never runs — and SIGTERM is exactly what
# Railway sends on every redeploy/rollover. Without the INT/TERM trap both
# children were orphan-reparented to PID 1 on that path, still holding
# :$AGENT_PORT and $PORT, so the replacement container could not bind. Same
# reasoning, and the same two traps, as
# showcase/integrations/spring-ai/entrypoint.sh and
# showcase/integrations/strands/entrypoint.sh — those two are the exact
# matches: `trap cleanup EXIT` plus `trap _on_signal INT TERM`, a `_CLEANED`
# idempotence flag, and an unconditional `exit 143` from the signal handler.
#
# Every OTHER entrypoint in showcase/integrations/*/entrypoint.sh — with ONE
# exception, named below — carries the SAME design (a `_CLEANED` flag,
# `trap cleanup EXIT`, and a signal handler that exits instead of falling back
# into the script) but a different SHAPE: it splits the signal trap into
# `trap '_on_signal INT' INT` plus `trap '_on_signal TERM' TERM` so the handler
# can exit 130 on INT and 143 on TERM. Read them as cousins, not as this file's
# twin.
#
# THE EXCEPTION IS built-in-agent, which carries NONE of this apparatus — no
# `_CLEANED`, no trap, no signal handler — and needs none. It is a single
# `exec env NODE_ENV=production npx next start`, so Next.js REPLACES the shell
# rather than running beside it: the platform's SIGTERM goes straight to
# Next.js, there is no shell left to trap it, and there is no second child to
# reap. Do not "fix" it by adding traps.
#
# Of the entrypoints that DO carry the design, four — mastra,
# langgraph-typescript, ms-agent-dotnet and strands-typescript — go further and
# tree-kill through /proc instead of signalling the direct child pids. The rest
# signal the direct child pids as this file does, EXCEPT langroid: it sends
# SIGTERM, polls a 5-second grace loop, and then escalates to `kill -9`.
# spring-ai — one of the two twins named above — escalates as well, through its
# `_terminate_pid` helper: SIGTERM, a 10-second poll, then SIGKILL, then a reap.
# So "one plain SIGTERM and no escalation" describes THIS file and strands, not
# spring-ai.
#
# Idempotent: _CLEANED makes the second call a no-op, so the signal path
# followed by the EXIT trap kills nothing twice.
#
# LIMITATION, stated honestly (as spring-ai does): cleanup sends ONE plain
# SIGTERM to the DIRECT child pids and does not wait or escalate to SIGKILL.
# NEXTJS_PID is the `env … npx next start` process, which may fork the real
# Next.js `node` server as a child — if npx does not forward the signal, that
# server can survive as an orphan still holding $PORT. mastra,
# langgraph-typescript, ms-agent-dotnet and strands-typescript solve that class
# with a /proc process-tree walk; langgraph-python has not adopted it yet.
_CLEANED=0
cleanup() {
  [ "$_CLEANED" = "1" ] && return 0
  _CLEANED=1
  kill $LANGGRAPH_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
_on_signal() {
  echo "[entrypoint] Received shutdown signal — terminating children"
  cleanup
  # 143 = 128 + SIGTERM, the conventional shell exit code for a SIGTERM death.
  exit 143
}
trap cleanup EXIT
trap _on_signal INT TERM

# Disable Python stdout buffering so langgraph_cli's dev server and any
# tracebacks it emits reach the Railway log stream immediately rather than
# sitting in Python's userspace buffer until the process exits. Paired with
# `python -u` on the langgraph_cli invocation below.
export PYTHONUNBUFFERED=1

echo "========================================="
echo "[entrypoint] Starting showcase: langgraph-python"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PWD: $(pwd)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Check critical env vars
echo "[entrypoint] Checking environment variables..."
if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[entrypoint] INFO: ANTHROPIC_API_KEY is not set"
else
  echo "[entrypoint] ANTHROPIC_API_KEY: set (${#ANTHROPIC_API_KEY} chars)"
fi

if [ -z "$LANGSMITH_API_KEY" ]; then
  echo "[entrypoint] INFO: LANGSMITH_API_KEY is not set (tracing disabled)"
else
  echo "[entrypoint] LANGSMITH_API_KEY: set (${#LANGSMITH_API_KEY} chars)"
fi

# Verify files exist. FATAL, not advisory: every path here is required to boot.
#
# The previous version only LOGGED "ERROR: … missing!" and carried on, which was
# worse than no check. Two lines later a bare `cat langgraph.json` under `set -e`
# killed the script with NO message of its own, so the operator saw an ERROR line
# followed by a silent death and had to guess the connection. This file already
# removed one misleading non-fatal path (see the LangGraph start check below);
# this is the same class of bug, so it dies here, loudly, naming the path.
_require_path() {
  local path="$1" label="$2"
  if [ -e "$path" ]; then
    ls -ld "$path"
    echo "[entrypoint] ${label}: OK"
  else
    echo "[entrypoint] FATAL: ${label} is missing at '${path}' (PWD: $(pwd)) — cannot boot"
    echo "[entrypoint] Exiting so Railway restarts the container"
    exit 1
  fi
}

echo "[entrypoint] Checking files..."
_require_path langgraph.json "langgraph.json"
_require_path src/agents/main.py "src/agents/main.py"
_require_path .next/server ".next build"

echo "[entrypoint] langgraph.json contents:"
cat langgraph.json

# Agent listen port. Deliberately AGENT_PORT and NOT PORT: this container still
# runs Next.js on $PORT, and two processes cannot bind the same port — pointing
# the agent at $PORT would collide and break the container. The fallback is
# 8123 (NOT 8000) because that is the port this integration listens on today;
# AGENT_PORT is unset in every deploy, so behaviour is byte-for-byte unchanged.
# It exists so the agent's port becomes a knob for the later single-process
# layout without another edit here.
#
# AGENT_PORT IS NOT A STANDALONE KNOB. It moves ONLY the agent's listen port.
# Every DEMO route in src/app/api/copilotkit* reads
# `process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123"` — all
# THIRTEEN of them, the voice, auth and mcp-apps catch-all routes included, with
# no AGENT_URL anywhere. So setting AGENT_PORT alone moves the agent away from the
# frontend still dials — every demo breaks while this entrypoint's watchdog
# (which follows AGENT_PORT) keeps reporting healthy.
# To change the agent port you MUST set LANGGRAPH_DEPLOYMENT_URL to match, e.g.
#   AGENT_PORT=9000 LANGGRAPH_DEPLOYMENT_URL=http://localhost:9000
# One NON-demo route differs and is worth knowing about: src/app/api/debug reads
# `AGENT_URL || LANGGRAPH_DEPLOYMENT_URL || "unknown"`. The line above still
# works for it (AGENT_URL is unset, so it falls through), but if AGENT_URL is
# ALSO set to something stale the debug page reports connectivity for a
# different URL than the demos actually use.
AGENT_PORT="${AGENT_PORT:-8123}"

echo "========================================="
echo "[entrypoint] Starting LangGraph agent server on port ${AGENT_PORT}..."
echo "========================================="

# Disable langgraph_runtime_inmem's pickle-flush-to-disk loop. Without this,
# the inmem runtime periodically flushes unbounded thread/checkpoint state to
# .langgraph_api/*.pckl files, which is a slow-burn OOM risk on Railway.
# The env var is checked at import time in langgraph_runtime_inmem
# _persistence.py and checkpoint.py (langgraph-api==0.7.101 / runtime==0.27.4).
export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true

# `python -u` forces unbuffered stdout/stderr at the interpreter level
# (belt-and-suspenders with PYTHONUNBUFFERED=1 above) so langgraph_cli boot
# failures surface in the Railway log stream immediately rather than sitting
# in a pipe buffer until the process exits. The `&> >(while read …)` prefixer
# replaces the previous `sed` pipe — process substitution leaves $! pointing at
# the real python process (pipe form made $! point at sed).
# The prefixer is a bash `while read`/`printf` loop and NOT `awk`: the images
# ship mawk, which block-buffers its INPUT, so `fflush()` never fired for a
# long-lived child and its lines never reached `docker logs` at all. Full
# explanation in showcase/integrations/mastra/entrypoint.sh — do not go back
# to awk.
# `--no-reload` disables watchfiles hot-reload, which fires on every request
# and causes "1 change detected" log spam → Railway 500-logs/sec kill.
python -u -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port "$AGENT_PORT" \
  --no-browser \
  --no-reload &> >(while IFS= read -r line; do printf '[langgraph] %s\n' "$line"; done) &
LANGGRAPH_PID=$!

# Give langgraph a moment to start
sleep 3

# Check if langgraph is still running
if kill -0 $LANGGRAPH_PID 2>/dev/null; then
  echo "[entrypoint] LangGraph agent server started (PID: $LANGGRAPH_PID)"
else
  echo "[entrypoint] ERROR: LangGraph agent server failed to start!"
  # Exit loudly instead of the old "Continuing with Next.js only" message,
  # which was never true: the dead LANGGRAPH_PID stays in the `wait -n` list
  # below, so wait reaps it on the very next line and the container exits
  # anyway — just with a log line that claims the opposite. Matches
  # showcase/integrations/strands/entrypoint.sh.
  echo "[entrypoint] Exiting so Railway restarts the container"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment. `ENV NODE_ENV=production` at the image level would
# leak into the Python langgraph process and any shell subprocesses; scope
# it here so non-Next children see the host's environment.
env NODE_ENV=production npx next start --port $PORT &> >(while IFS= read -r line; do printf '[nextjs] %s\n' "$line"; done) &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the langgraph process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :$AGENT_PORT.
# Poll the langgraph_cli /ok endpoint every 30s; after 3 consecutive failures
# (at least ~90s of unreachable agent — each failed probe can additionally burn
# up to the `curl --max-time 5` timeout, so 3 strikes is 90s PLUS up to 5s per
# strike, never less than 90s), kill the agent process so `wait -n` returns
# and Railway restarts the container. Generalized from
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
#
# Startup grace: langgraph_cli dev does a heavy cold-start (graph compile
# + uvicorn boot). On fresh Railway containers this can exceed the 90s
# (3-strike) budget introduced in PR #4116, matching the restart loop
# observed on langgraph-typescript (deployment
# 58bbebe8-7a94-4f99-b6e4-ffcbb4eb78b9, 04-20 17:05 UTC). Wait up to 180s
# for the first healthy /ok probe before arming the strike counter; if
# /ok comes up sooner, fall through immediately. If 180s elapses without
# success, arm the counter anyway — the steady-state watchdog will then
# handle a true hang. "180s" is a FLOOR too: `ELAPSED` counts only the loop's
# own `sleep 5`, so every probe that hangs adds up to its `curl --max-time 5`
# on top. Read it as "at least 180s".
(
  GRACE=180
  echo "[watchdog] Startup grace: waiting up to ${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $LANGGRAPH_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/ok" > /dev/null 2>&1; then
      echo "[watchdog] Agent healthy after ${ELAPSED}s — arming strike counter"
      break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
  done
  if [ $ELAPSED -ge $GRACE ]; then
    echo "[watchdog] Grace window elapsed without successful probe — arming strike counter anyway"
  fi
  FAILS=0
  while sleep 30; do
    if ! kill -0 $LANGGRAPH_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/ok" > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for at least ~90s (plus up to 5s per failed probe) — killing PID $LANGGRAPH_PID to trigger container restart"
        kill -9 $LANGGRAPH_PID 2>/dev/null || true
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:${AGENT_PORT}/ok, startup grace 180s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first (e.g. because it
# killed the agent), wait -n would otherwise return with the watchdog's exit
# code and short-circuit before the agent's true exit status is observable.
#
# `|| EXIT_CODE=$?` is LOAD-BEARING under `set -e`: the PRIMARY designed exit
# path here is a NON-ZERO wait (137 = the watchdog's `kill -9` of the agent, or
# an agent crash). Without the `||` guard, `set -e` aborts the script AT this
# line on exactly those interesting exits, making the entire "which process
# exited with code N" diagnostic below AND the final explicit `exit $EXIT_CODE`
# dead code.
#
# REAPED_PID via `wait -n -p VAR` (bash >= 5.1; the python:3.12-slim runner
# ships 5.2) captures the ACTUAL PID `wait -n` reaped, so the diagnostic names
# the correct process even when both die near-simultaneously. A `kill -0` probe
# AFTER the wait only INFERS it, and mislabels when both are already dead.
REAPED_PID=""
EXIT_CODE=0
wait -n -p REAPED_PID "$LANGGRAPH_PID" "$NEXTJS_PID" || EXIT_CODE=$?
if [ "$REAPED_PID" = "$LANGGRAPH_PID" ]; then
  echo "[entrypoint] LangGraph (PID: $LANGGRAPH_PID) exited with code $EXIT_CODE"
elif [ "$REAPED_PID" = "$NEXTJS_PID" ]; then
  echo "[entrypoint] Next.js (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process (PID: ${REAPED_PID:-unknown}) exited with code $EXIT_CODE"
fi
exit $EXIT_CODE
