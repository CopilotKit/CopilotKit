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
# and KEEP RUNNING — still bound to :8123, still holding the bloated in-memory
# state.  The size-gate's whole promise ("kill agent → container restart →
# boot-purge") is then broken: the frontend proxies to a dead-but-not-restarted
# agent forever (edge 502s), and even if the container does exit, a surviving
# orphan can still hold :8123 across the restart.
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
  # actually dies and frees :8123 — not just the log-pipeline subshell.
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
  # PID 1, still holding :8123 across the restart.  See _kill_agent_tree.
  _kill_agent_tree "$AGENT_PID"
  kill $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
  # NOTE: SIZE_PID is intentionally NOT killed here.  SIZE_PID is assigned
  # inside the watchdog subshell ( ) & so it is never visible in this outer
  # shell.  The subshell registers its own EXIT trap to kill its SIZE_PID; see
  # the "trap ... EXIT" inside the ( ) & block below.
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Size-check seam: extract the per-cycle size-check-and-kill decision so it
# can be exercised directly in tests without running the full entrypoint stack.
#
# Usage (normal): called by the watchdog size sub-loop below.
# Usage (test):   LANGGRAPH_SIZE_THRESHOLD_MB=X LANGGRAPH_PERSIST_DIR_OVERRIDE=Y
#                 AGENT_PID=Z bash entrypoint.sh --check-size-once
#
# Returns 0 if no action taken, 1 if the agent was killed (threshold exceeded).
# Callers under set -e should invoke with || true if 1 is acceptable.
# ---------------------------------------------------------------------------
_watchdog_check_size_once() {
  local persist_dir="${PERSIST_DIR}"
  local threshold_mb="${SIZE_THRESHOLD_MB}"
  local agent_pid="${AGENT_PID}"

  if ! kill -0 "$agent_pid" 2>/dev/null; then
    return 0
  fi
  if [ ! -d "$persist_dir" ]; then
    echo "[watchdog:size] Persistence dir ${persist_dir} does not exist — skipping size check"
    return 0
  fi
  # du -sm returns on-disk size in MiB as an integer.  This is a heuristic
  # proxy for the in-memory superjson-serialised string size: @langchain/
  # langgraph-api serialises state to disk on a 3-second timer, so on-disk
  # size closely tracks serialised size but is NOT a proven bound.  We set a
  # conservative threshold (200 MB, well under V8's ~512 MB string ceiling)
  # to leave margin for this approximation.
  # || true prevents set -e from killing this subshell if du fails.
  DIR_SIZE_MB=$(du -sm "$persist_dir" 2>/dev/null | awk '{print $1}') || true
  if [ -z "$DIR_SIZE_MB" ]; then
    echo "[watchdog:size] WARNING: Could not read size of ${persist_dir} — size guard inactive this cycle"
    return 0
  fi
  echo "[watchdog:size] Persistence dir size: ${DIR_SIZE_MB}MB (threshold: ${threshold_mb}MB)"
  if [ "$DIR_SIZE_MB" -ge "$threshold_mb" ]; then
    echo "[watchdog:size] Size threshold exceeded (${DIR_SIZE_MB}MB >= ${threshold_mb}MB) — killing agent PID $agent_pid (and its npm→node tree) to trigger container restart and boot-purge"
    # NOTE: this kill WILL terminate any in-flight streaming runs — accepted
    # tradeoff vs OOM/crash.  The gate is threshold-based (not a fixed timer)
    # so it fires only when state has grown dangerously large.
    # Tree-kill (not a bare `kill -9 $agent_pid`): $agent_pid is the process-sub
    # subshell, so a single-PID kill would orphan the real npm→node server,
    # leaving :8123 bound and the boot-purge never re-run.  See _kill_agent_tree.
    _kill_agent_tree "$agent_pid"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Test seam: --check-size-once mode
# Runs exactly one size-check cycle using env vars for configuration, then
# exits.  Designed to be called from tests with a stubbed `du` on PATH.
# Exit code: 0 = under threshold (no kill), 1 = threshold exceeded (kill issued).
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--check-size-once" ]; then
  # In test-seam mode the caller owns the agent PID lifecycle.  Clearing the
  # EXIT trap ensures cleanup() does NOT send a spurious SIGTERM to AGENT_PID
  # on the way out, which would mask whether the size gate actually fired
  # (gate fires → SIGKILL; cleanup fires → SIGTERM; both make poll() non-None,
  # but only SIGKILL proves the gate killed the right PID).
  trap - EXIT
  PERSIST_DIR=${LANGGRAPH_PERSIST_DIR_OVERRIDE:-/app/src/agent/.langgraph_api}
  SIZE_THRESHOLD_MB=${LANGGRAPH_SIZE_THRESHOLD_MB:-200}
  AGENT_PID=${AGENT_PID:-0}
  _watchdog_check_size_once
  exit $?
fi

echo "========================================="
echo "[entrypoint] Starting showcase package: langgraph-typescript"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Purge any persisted FileSystemPersistence state from a prior container.
# @langchain/langgraph-api (v1.1.17) serialises ALL accumulated thread/run/
# checkpoint state via superjson.stringify on a 3-second timer; after enough
# runs the serialised string exceeds V8's ~512 MB string limit → uncaught
# RangeError in a Timeout callback → event-loop hang → watchdog kill.
# Because the state persists to disk, a plain container restart reloads the
# bloated file and re-crashes immediately. Deleting on every fresh boot breaks
# the cycle.
#
# PERSIST_DIR can be overridden by env var (useful for tests; defaults to the
# in-container path used by @langchain/langgraph-api's FileSystemPersistence).
PERSIST_DIR=${LANGGRAPH_PERSIST_DIR_OVERRIDE:-/app/src/agent/.langgraph_api}
if [ -d "$PERSIST_DIR" ]; then
  echo "[entrypoint] Purging stale LangGraph persistence state from prior container boot (${PERSIST_DIR})"
  rm -rf "$PERSIST_DIR"
  echo "[entrypoint] Purge complete"
else
  echo "[entrypoint] No prior persistence state found — clean boot"
fi

# Start LangGraph agent server in background.
# `npm start` runs `node --import tsx liveness.mjs` (see src/agent/package.json).
# liveness.mjs binds :8124/ok immediately using only node:http, then dynamic-
# imports server.mjs to kick off the real @langchain/langgraph-api bootstrap.
# We avoid `langgraph-cli dev` for the same reasons as before: dev wraps the
# server in `tsx watch` + chokidar + Studio IPC, and its schema-extraction
# worker is cold on first request (multi-second TS program compile).
# Production path:
#   1. `node --import tsx liveness.mjs` — tsx is a one-shot ESM hook so the
#      subsequent dynamic import of server.mjs (and thence graph.ts) resolves
#      without pre-compilation. NOT a watcher.
#   2. liveness.mjs brings up :8124/ok before any heavy import runs.
#   3. Dynamic-imported server.mjs pre-warms the schema cache before the
#      first external /assistants/*/schemas hits.
#
# --host 0.0.0.0 via HOST env; binds IPv4+IPv6 so the Next.js frontend can
# reach the agent regardless of how `localhost` resolves in the container.
#
# Log prefixing uses bash process substitution (`&> >(awk …)`) rather than a
# pipe (`| sed …`): process substitution leaves `$!` pointing at the real
# node process, so `wait -n $AGENT_PID` monitors the right thing.
echo "[entrypoint] Starting LangGraph TS agent on port 8123 (prod mode, no CLI)..."
cd /app/src/agent && PORT=8123 HOST=0.0.0.0 npm start &> >(awk '{print "[agent] " $0; fflush()}') &
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
# silent agent hang — the langgraph process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :8123.
# Poll the liveness sidecar on :8124/ok every 30s (bound by liveness.mjs
# BEFORE server.mjs is dynamic-imported, so it is up within ms of node boot —
# independent of the multi-minute @langchain/langgraph-api top-level import
# that gates the main Hono bind on :8123). After 3 consecutive failures
# (~90s of unreachable agent), kill the agent process so `wait -n` returns
# and Railway restarts the container. Generalized from
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
#
# Startup grace: langgraph-cli dev does a heavy cold-start (Studio IPC +
# @langchain/langgraph-api spawn + graph compile). On fresh Railway
# containers this routinely exceeds the 90s (3-strike) budget introduced
# in PR #4116, producing the 04-20 restart loop seen on deployment
# 58bbebe8-7a94-4f99-b6e4-ffcbb4eb78b9. Wait up to 180s for the first
# healthy /ok probe before arming the strike counter; if /ok comes up
# sooner, fall through immediately. If 180s elapses without success, arm
# the counter anyway — the steady-state watchdog will handle a true hang.
#
# Size-gated restart: the watchdog also periodically checks the on-disk size
# of the PERSIST_DIR. @langchain/langgraph-api serialises state on a 3-second
# timer; if the state grows excessively (threads accumulating across a long
# deployment) the serialised string can approach V8's ~512 MB string limit.
# We set a conservative SIZE_THRESHOLD_MB (200 MB — well under the ceiling,
# with margin for the on-disk→in-memory approximation) and kill the agent
# when crossed, triggering a container restart which re-runs the boot-purge
# above.  This kill WILL terminate any in-flight streaming runs — accepted
# tradeoff vs OOM/crash.  The gate is threshold-based, not a fixed timer,
# so it fires only when state has grown dangerously large.
# We do NOT call POST /internal/truncate because:
#   1. ops.truncate with runs+threads+checkpointer+store=true wipes ALL runs
#      including in-flight ones — the "in-flight not disrupted" comment on the
#      original implementation was incorrect (R7-C1).
#   2. /internal/truncate is an unpinned internal library route with no
#      stability guarantee across patch releases (C2).
SIZE_THRESHOLD_MB=${LANGGRAPH_SIZE_THRESHOLD_MB:-200}
# 60s interval: the 3-second serialize timer means state can grow rapidly
# under heavy probe fan-out (the original crash scenario).  300s (5 min)
# leaves too large a window — at typical probe rates state can exceed 512MB
# before the next check.  60s keeps the check-to-ceiling budget comfortable.
SIZE_CHECK_INTERVAL=${LANGGRAPH_SIZE_CHECK_INTERVAL:-60}
(
  GRACE=180
  echo "[watchdog] Startup grace: waiting up to ${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8124/ok > /dev/null 2>&1; then
      echo "[watchdog] Agent healthy after ${ELAPSED}s — arming strike counter"
      break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
  done
  if [ $ELAPSED -ge $GRACE ]; then
    echo "[watchdog] Grace window elapsed without successful probe — arming strike counter anyway"
  fi

  # Size-gated restart sub-loop: periodically check the persistence dir size
  # and kill the agent if it exceeds SIZE_THRESHOLD_MB. The container restart
  # will re-run the boot-purge, clearing accumulated state safely.
  (
    echo "[watchdog:size] Starting size-gated restart monitor (threshold=${SIZE_THRESHOLD_MB}MB, interval=${SIZE_CHECK_INTERVAL}s, dir=${PERSIST_DIR})"
    while sleep $SIZE_CHECK_INTERVAL; do
      _watchdog_check_size_once || break
    done
  ) &
  SIZE_PID=$!
  # Register EXIT trap INSIDE this watchdog subshell so the size sub-loop is
  # reaped on any exit path (normal, kill, SIGTERM from outer cleanup).
  # This is the only reliable cleanup path: SIZE_PID is local to this subshell
  # and is never visible in the outer shell, so the outer cleanup() cannot
  # kill it.
  trap 'kill "$SIZE_PID" 2>/dev/null || true' EXIT

  FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8124/ok > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for ~90s — killing PID $AGENT_PID (and its npm→node tree) to trigger container restart"
        # Tree-kill for the same reason as the size gate: $AGENT_PID is the
        # process-sub subshell; a single-PID kill would orphan npm→node and
        # leave :8123 bound to a hung agent that `wait -n` never observes dying.
        _kill_agent_tree "$AGENT_PID"
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:8124/ok, startup grace 180s, size-guard threshold ${SIZE_THRESHOLD_MB}MB every ${SIZE_CHECK_INTERVAL}s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first, `wait -n` would
# otherwise return with the watchdog's exit code and short-circuit before
# the agent's true exit status is observable.
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
