#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Agent process-tree kill.
#
# The agent is launched as a compound command through a process substitution:
#   cd /app/src/agent && ... npm start &> >(awk …) &
# so $AGENT_PID (=$!) is the *outer subshell* wrapping that pipeline — NOT the
# `npm` wrapper nor the `node` server it forks.  A plain `kill -9 $AGENT_PID`
# therefore reaps only the subshell: `npm` and `node` are reparented to PID 1
# and KEEP RUNNING — still bound to :8000.  The watchdog's whole promise
# ("kill agent → wait -n returns → container restart") is then broken: the
# frontend proxies to a dead-but-not-restarted agent forever (edge 502s), and
# even if the container does exit, a surviving orphan can still hold :8000
# across the restart.
#
# We cannot `kill -- -$PGID` because a non-interactive script has job control
# OFF: the agent subshell, npm, node, next.js AND the main shell all share the
# shell's process group, so a group kill would take out the whole entrypoint.
# Instead we walk the process tree via /proc (node:22-slim ships neither
# `ps` nor `pgrep`) and SIGKILL every descendant, deepest-first, then the root.
#
# Defined ABOVE cleanup() on purpose: cleanup() (the EXIT/SIGTERM trap) calls
# _kill_agent_tree, so the helper must already exist whenever the trap can
# first fire — including the early `exit 1` below if the agent fails to start.
# ---------------------------------------------------------------------------
_agent_descendants() {
  # Print all descendant PIDs of $1 (children, grandchildren, …), deepest-first.
  local root="$1" pid ppid stat
  for pid in $(cd /proc 2>/dev/null && ls -d [0-9]* 2>/dev/null); do
    [ -r "/proc/$pid/stat" ] || continue
    # comm (field 2) can contain spaces/parens, so strip through the final ')'
    # before splitting; PPID is then the 2nd field of the remainder.
    stat=$(cat "/proc/$pid/stat" 2>/dev/null) || continue
    ppid=$(echo "${stat##*) }" | awk '{print $2}')
    if [ "$ppid" = "$root" ]; then
      _agent_descendants "$pid"
      echo "$pid"
    fi
  done
}

_kill_agent_tree() {
  # SIGKILL the agent subshell AND its npm→node descendants so the real server
  # actually dies and frees :8000 — not just the log-pipeline subshell.
  local root="$1" p
  for p in $(_agent_descendants "$root"); do
    kill -9 "$p" 2>/dev/null || true
  done
  kill -9 "$root" 2>/dev/null || true
}

cleanup() {
  # Tree-kill the agent (not a bare `kill $AGENT_PID`): $AGENT_PID is the
  # process-sub subshell, so a single-PID kill on the normal shutdown path
  # (graceful exit / SIGTERM on every Railway redeploy/rollover) would reap
  # only the subshell and ORPHAN the real npm→node server — reparented to
  # PID 1, still holding :8000 across the restart.  See _kill_agent_tree.
  _kill_agent_tree "$AGENT_PID"
  kill $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "========================================="
echo "[entrypoint] Starting showcase package: strands-typescript"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

# Start the Strands TS agent server on :8000.
# `npm start` runs `node --import tsx server.ts` (see src/agent/package.json).
# tsx is a one-shot ESM loader here (NOT a watcher) so server.ts and its
# imports resolve without a precompile step. Log prefixing uses bash process
# substitution (`&> >(awk …)`) rather than a pipe so `$!` points at the real
# node process and `wait -n $AGENT_PID` monitors the right thing.
echo "[entrypoint] Starting Strands TS agent on port 8000..."
cd /app/src/agent && PORT=8000 HOST=0.0.0.0 npm start &> >(awk '{print "[agent] " $0; fflush()}') &
AGENT_PID=$!
cd /app
sleep 3
if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent server started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent server failed to start — exiting"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment. `ENV NODE_ENV=production` at the image level would
# leak into every child process (agent, shell, healthchecks). `env` prefix
# binds the value to this single exec.
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the process stays alive (so `wait -n` never fires and
# the container never restarts) but stops responding on :8000. Poll
# /health every 30s; after 3 consecutive failures (~90s unreachable), kill
# the agent so `wait -n` returns and Railway restarts the container.
(
  FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for ~90s — killing PID $AGENT_PID (and its npm→node tree) to trigger container restart"
        # Tree-kill (not a bare `kill -9 $AGENT_PID`): $AGENT_PID is the process-sub
        # subshell, so a single-PID kill would orphan the real npm→node server,
        # leaving :8000 bound to a hung agent that `wait -n` never observes dying.
        _kill_agent_tree "$AGENT_PID"
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!

echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog.
wait -n $AGENT_PID $NEXTJS_PID
EXIT_CODE=$?
if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif ! kill -0 $NEXTJS_PID 2>/dev/null; then
  echo "[entrypoint] Next.js (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process exited with code $EXIT_CODE"
fi

exit $EXIT_CODE
