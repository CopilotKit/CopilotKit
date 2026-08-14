#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Process-tree kill.
#
# Both long-lived children are launched as compound commands through a process
# substitution:
#   dotnet /agent/ProverbsAgent.dll … &> >(while read …) &
#   env NODE_ENV=production npx next start … &> >(while read …) &
# so $AGENT_PID / $NEXTJS_PID (=$!) are the *outer subshells* wrapping those
# pipelines — NOT the `dotnet` process and NOT the `node` server that
# `npx next start` forks.  A plain `kill $NEXTJS_PID` therefore reaps only the
# subshell: `npx` and the real Next.js `node` server are reparented to PID 1 and
# KEEP RUNNING — still bound to $PORT.  On a Railway redeploy/rollover the
# replacement container then cannot bind $PORT.  The same applies to the
# watchdog's `kill -9 $AGENT_PID`: it would leave the real agent holding
# :$AGENT_PORT while the frontend proxies to a dead-but-not-restarted agent.
#
# We cannot `kill -- -$PGID` because a non-interactive script has job control
# OFF: the child subshells, dotnet, npx, node AND the main shell all share the
# shell's process group, so a group kill would take out the whole entrypoint.
# Instead we walk the process tree via /proc (the aspnet runner image ships
# neither `ps` nor `pgrep`) and SIGKILL every descendant, deepest-first, in a
# BOUNDED re-scan loop that keeps the root alive as the walk anchor until the
# subtree is drained, then kills the root last (see _kill_process_tree for why).
#
# Defined ABOVE cleanup() on purpose: cleanup() (the EXIT/INT/TERM trap) calls
# _kill_process_tree, so the helper must already exist whenever the trap can
# first fire — including the early `exit 1` below if the agent fails to start.
# Mirrors showcase/integrations/mastra/entrypoint.sh and
# showcase/integrations/langgraph-typescript/entrypoint.sh.
# ---------------------------------------------------------------------------
_process_descendants() {
  # Print all descendant PIDs of $1 (children, grandchildren, …), deepest-first.
  local root="$1" pid ppid stat _state _rest
  # Fail closed on a dangerous or meaningless root.  A root of "0" means "every
  # process in the caller's process group" and "1" is init — a caller that fed
  # either to a kill could wipe the whole container.  Refuse anything that is
  # not an integer >= 2.
  case "$root" in
    ''|*[!0-9]*) echo "[proctree] WARNING: refusing descendant scan for non-numeric root '${root}'" >&2; return 0 ;;
  esac
  if [ "$root" -le 1 ]; then
    echo "[proctree] WARNING: refusing descendant scan for reserved root ${root} (0=process-group, 1=init)" >&2
    return 0
  fi
  for pid in $(cd /proc 2>/dev/null && ls -d [0-9]* 2>/dev/null); do
    [ -r "/proc/$pid/stat" ] || continue
    # /proc/PID/stat is: "PID (comm) STATE PPID PGRP …". comm can contain spaces
    # AND parens, so strip through the final ") " before splitting; PPID is then
    # the 2nd field of the remainder (1st is STATE). "${x##*) }" takes the
    # LONGEST prefix up to the LAST ") ", which is always the comm's real
    # terminator, so even a comm like "(evil) S 1)" parses to the true PPID.
    # Read the line with a REDIRECTION into the `read` builtin, not `$(cat …)`.
    # Both work, but `$(cat …)` forks a subshell AND execs /bin/cat once per
    # /proc entry, which is the very fork-storm the `read` below is here to
    # avoid — a `cat` per PID undoes the saving from not running `awk` per PID.
    # The clear-then-test guard, not a bare `|| continue`, covers TWO cases:
    # the PID vanishing between the `ls` and this line (the redirection fails,
    # and `2>/dev/null` keeps bash quiet about it), and a read that returns
    # non-zero purely because the line carried no trailing newline yet still
    # filled $stat. Clearing $stat first is what makes the emptiness test safe —
    # without it a failed read would leave the PREVIOUS iteration's line in
    # place and this PID would be scored against another process's PPID.
    stat=""
    read -r stat < "/proc/$pid/stat" 2>/dev/null || true
    [ -n "$stat" ] || continue
    # Same reason as above: use the `read` builtin rather than `echo … | awk`, so
    # no external process is spawned per /proc entry.
    read -r _state ppid _rest <<< "${stat##*) }"
    if [ "$ppid" = "$root" ]; then
      _process_descendants "$pid"
      echo "$pid"
    fi
  done
}

_kill_process_tree() {
  # SIGKILL the wrapper subshell AND its descendants so the real server actually
  # dies and frees its port — not just the log-pipeline subshell.
  #
  # A single snapshot-then-kill is racy: a descendant that forks a new child
  # BETWEEN the scan and the kill is missed by the walk, reparents to PID 1, and
  # keeps the port bound — defeating the whole tree-kill.  So we re-scan in a
  # BOUNDED loop, killing the currently-live descendants deepest-first each
  # pass, until a scan comes back empty (or the bound is hit).  Crucially we
  # keep the ROOT alive as the walk anchor across passes and kill it LAST:
  # killing root first would immediately reparent every descendant to PID 1,
  # making them unreachable by a root-anchored PPID walk.
  #
  # Residual limitation: a descendant that FULLY reparents to PID 1 (double-fork
  # / daemonize) before we reach it is no longer on any PPID chain from root and
  # cannot be found by a /proc PPID walk. Neither the dotnet agent nor the
  # npx→node Next.js tree daemonizes, so this loop covers the real surface.
  #
  # Fail closed on a dangerous or meaningless root BEFORE any kill runs: a bare
  # `kill -9 0` would SIGKILL the entire entrypoint's process group.
  local root="$1" p descendants
  case "$root" in
    ''|*[!0-9]*) echo "[proctree] WARNING: refusing tree-kill for non-numeric PID '${root}'" >&2; return 0 ;;
  esac
  if [ "$root" -le 1 ]; then
    echo "[proctree] WARNING: refusing tree-kill for reserved PID ${root} (0=process-group, 1=init)" >&2
    return 0
  fi
  for _ in 1 2 3 4 5; do
    descendants=$(_process_descendants "$root")
    [ -z "$descendants" ] && break
    for p in $descendants; do
      kill -9 "$p" 2>/dev/null || true
    done
    # `|| true`: under set -e a non-zero `sleep` would abort this tree-kill
    # mid-walk, leaving the root un-killed and the real server orphaned.
    sleep 0.2 || true
  done
  kill -9 "$root" 2>/dev/null || true
}

# Validate ONE operator-overridable numeric knob by name and rewrite it in
# place: a positive integer is kept, anything else WARNs and falls back to the
# documented default. Without this, a typo like STARTUP_GRACE_SECONDS="180s"
# would propagate into an arithmetic test that silently evaluates false (guard
# skipped, no warning) or into a `sleep` that fails on the first iteration and
# kills the loop for the container's lifetime. Fails SAFE — never aborts.
# Leading-zero values are rejected too: bash reads "010" as OCTAL (=8) and an
# "08"/"09" digit aborts under `set -e`. Length is capped at 10 digits because
# bash arithmetic is signed 64-bit and a 20+ digit value overflows.
#
# Args: $1 = variable NAME, $2 = documented default, $3 = human label
_require_int() {
  local name="$1" default="$2" label="$3" value
  eval "value=\${$name}"
  if [ "${#value}" -gt 10 ]; then
    echo "[entrypoint] WARNING: ${label} (${name}) is too large (got: '${value}', ${#value} digits — max 10) — falling back to default ${default}"
    printf -v "$name" '%s' "$default"
    return 0
  fi
  case "$value" in
    [1-9]) : ;;                # single positive digit
    [1-9][0-9]*)               # multi-digit, must be all digits after the lead
      case "$value" in
        *[!0-9]*)
          echo "[entrypoint] WARNING: ${label} (${name}) is not a positive integer (got: '${value}') — falling back to default ${default}"
          printf -v "$name" '%s' "$default"
          ;;
      esac
      ;;
    *)
      echo "[entrypoint] WARNING: ${label} (${name}) is not a positive integer (got: '${value}') — falling back to default ${default}"
      printf -v "$name" '%s' "$default"
      ;;
  esac
}

# Process handles the EXIT/SIGTERM trap reads. Declared (empty) BEFORE the trap is
# installed because cleanup() can fire on a path where some of them are not
# assigned yet — most importantly the `exit 1` below when the agent fails to start,
# which happens before Next.js and the watchdog exist, and a SIGTERM arriving
# during the `sleep 3` right after the agent launch. With them unset, cleanup()
# printed "[proctree] WARNING: refusing tree-kill for non-numeric PID ''" plus a
# swallowed `kill` usage error, burying the one line an operator needs in the
# Railway log ("ERROR: Agent failed to start"). The guards in cleanup() skip each
# kill whose handle is still empty, so the shutdown path stays silent about
# processes that were never started.
AGENT_PID=""
NEXTJS_PID=""
WATCHDOG_PID=""

# Set once cleanup() has run, so it cannot run twice. With a single
# `trap cleanup EXIT INT TERM`, a SIGTERM ran cleanup for the TERM trap, then
# bash exited and ran it AGAIN for the EXIT trap — two full /proc walks per
# shutdown, on the normal Railway redeploy path. Same guard as mastra.
_CLEANED=0

cleanup() {
  if [ "$_CLEANED" = "1" ]; then
    return 0
  fi
  _CLEANED=1
  # Tree-kill both children (NOT a bare `kill $AGENT_PID $NEXTJS_PID`): each PID
  # is the process-sub wrapper subshell, so a single-PID kill on the normal
  # shutdown path would reap only the wrapper and ORPHAN the real dotnet agent /
  # Next.js node server — reparented to PID 1, still holding :$AGENT_PORT and
  # $PORT across a Railway redeploy/rollover. See _kill_process_tree.
  #
  # WATCHDOG_PID is a genuine single-PID subshell we spawn directly (`( … ) &`,
  # not process-sub-wrapped) that forks nothing outliving it, so a bare kill is
  # correct for it.
  if [ -n "$AGENT_PID" ]; then
    _kill_process_tree "$AGENT_PID"
  fi
  if [ -n "$NEXTJS_PID" ]; then
    _kill_process_tree "$NEXTJS_PID"
  fi
  if [ -n "$WATCHDOG_PID" ]; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
  fi
  # Explicit success. With every handle empty (the agent-failed-to-start path) the
  # last `if` evaluates false, so cleanup() would return non-zero. Bash keeps the
  # pre-trap exit status, so that does not change the script's exit code today —
  # but this trap also runs on INT/TERM and under `set -e`, and a function that
  # reports failure purely because it had nothing to kill is a trap waiting for the
  # next edit. Pin it to 0.
  return 0
}
# EXIT alone does NOT cover SIGTERM: an untrapped SIGTERM kills bash by signal
# and the EXIT trap never runs — which is precisely the Railway
# redeploy/rollover path this cleanup exists for. Trap the signals explicitly.
#
# SEPARATE SIGNAL AND EXIT TRAPS, matching mastra. A single
# `trap cleanup EXIT INT TERM` left the signal path falling back into the
# script: `wait -n` was INTERRUPTED rather
# than reaping a child, so `wait -n -p REAPED_PID` never assigned REAPED_PID and
# the diagnostic below printed "A process (PID: unknown) exited with code 143"
# on every clean SIGTERM — an anomaly-shaped log line for what is the ordinary
# redeploy path. Handling the signal and exiting inside the handler means that
# diagnostic is only ever reached when a child really did die on its own.
_on_signal() {
  echo "[entrypoint] Received shutdown signal — terminating children"
  cleanup
  # 128 + signal number, the shell convention, so the container's exit status
  # still says WHICH signal stopped it. `docker stop` sends TERM, so 143.
  case "$1" in
    INT) exit 130 ;;
    *) exit 143 ;;
  esac
}
trap '_on_signal INT' INT
trap '_on_signal TERM' TERM
trap cleanup EXIT

echo "========================================="
echo "[entrypoint] Starting showcase package: ms-agent-dotnet"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$AZURE_OPENAI_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: Neither AZURE_OPENAI_API_KEY nor OPENAI_API_KEY is set! Agent will fail."
fi

# Agent listen port. Deliberately AGENT_PORT and NOT PORT: this container still
# runs Next.js on $PORT, and two processes cannot bind the same port — pointing
# the agent at $PORT would collide and break the container. AGENT_PORT is unset
# in every deploy today, so the agent still lands on 8000 and behaviour is
# byte-for-byte unchanged.
#
# AGENT_PORT IS NOT A STANDALONE KNOB. It moves ONLY the agent's listen port;
# the Next.js routes dial the agent through their own AGENT_URL default, so
# AGENT_PORT must be set together with a matching AGENT_URL, e.g.
#   AGENT_PORT=9000 AGENT_URL=http://localhost:9000
AGENT_PORT="${AGENT_PORT:-8000}"
_require_int AGENT_PORT 8000 ".NET agent port"

# Start .NET agent backend on :$AGENT_PORT with log prefixing so its output is
# distinguishable from Next.js in the Railway log stream.
# The prefixer is a bash `while read`/`printf` loop and NOT `awk`: the images
# ship mawk, which block-buffers its INPUT, so `fflush()` never fired for a
# long-lived child and its lines never reached `docker logs` at all. Full
# explanation in showcase/integrations/mastra/entrypoint.sh — do not go back
# to awk.
# Note $!/AGENT_PID is the WRAPPING SUBSHELL of the `... &` compound command,
# NOT the dotnet process itself — never `kill $AGENT_PID` directly, use
# _kill_process_tree.
echo "[entrypoint] Starting .NET agent on port ${AGENT_PORT}..."
dotnet /agent/ProverbsAgent.dll --urls "http://0.0.0.0:${AGENT_PORT}" &> >(while IFS= read -r line; do printf '[agent] %s\n' "$line"; done) &
AGENT_PID=$!
sleep 3
if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent failed to start — exiting"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
env NODE_ENV=production npx next start --port $PORT &> >(while IFS= read -r line; do printf '[nextjs] %s\n' "$line"; done) &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the agent process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :$AGENT_PORT.
# Poll the agent's /health endpoint; after HEALTH_STRIKE_LIMIT consecutive
# failures, kill the agent process tree so `wait -n` returns and Railway
# restarts the container. Generalized from
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
#
# Startup grace: the .NET agent pays a cold-start (JIT + host build + Azure
# OpenAI client construction) before /health answers. Without a grace window
# the hardcoded 3-strike / 30s budget kills the agent ~90s after boot and the
# container enters a restart loop — the same failure the sibling entrypoints
# (mastra, langgraph-typescript) fixed by waiting for the FIRST healthy probe
# before arming the strike counter. Wait up to STARTUP_GRACE_SECONDS; if
# /health comes up sooner, fall through immediately. If the window elapses
# without success, arm the counter anyway so a true hang is still caught.
#
# All three knobs are operator-overridable so deploy tuning does not require an
# image rebuild.
STARTUP_GRACE_SECONDS=${MS_AGENT_STARTUP_GRACE_SECONDS:-180}
HEALTH_CHECK_INTERVAL=${MS_AGENT_HEALTH_CHECK_INTERVAL:-30}
HEALTH_STRIKE_LIMIT=${MS_AGENT_HEALTH_STRIKE_LIMIT:-3}
_require_int STARTUP_GRACE_SECONDS 180 ".NET agent startup grace window (s)"
_require_int HEALTH_CHECK_INTERVAL  30 ".NET agent health-probe interval (s)"
_require_int HEALTH_STRIKE_LIMIT     3 ".NET agent health strike limit"
(
  GRACE=$STARTUP_GRACE_SECONDS
  echo "[watchdog] Startup grace: waiting up to ${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
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
  while sleep "$HEALTH_CHECK_INTERVAL"; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge "$HEALTH_STRIKE_LIMIT" ]; then
        echo "[watchdog] Agent unresponsive for ~$((HEALTH_CHECK_INTERVAL * HEALTH_STRIKE_LIMIT))s — killing PID $AGENT_PID (and its process tree) to trigger container restart"
        # Tree-kill (not a bare `kill -9 $AGENT_PID`): $AGENT_PID is the
        # process-sub subshell, so a single-PID kill would orphan the real
        # dotnet agent, leaving :$AGENT_PORT bound to a hung agent that
        # `wait -n` never observes dying.
        _kill_process_tree "$AGENT_PID"
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!

echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:${AGENT_PORT}/health, startup grace ${STARTUP_GRACE_SECONDS}s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first, an arg-less
# `wait -n` would return the WATCHDOG's status (0) and the container would
# exit 0 on an agent crash.
#
# `|| EXIT_CODE=$?` is LOAD-BEARING under `set -e`: the PRIMARY designed exit
# path here is a NON-ZERO wait (137 = the watchdog's tree-kill of the agent, or
# an agent crash). Without the `||` guard, `set -e` aborts the script AT this
# line on exactly those interesting exits, making the entire "which process
# exited with code N" diagnostic below AND the final explicit `exit $EXIT_CODE`
# dead code.
#
# REAPED_PID via `wait -n -p VAR` (bash >= 5.1; the aspnet:9.0 Debian runner
# ships 5.2) captures the ACTUAL PID `wait -n` reaped. The previous `kill -0`
# if/elif merely INFERRED which process exited by probing liveness AFTER the
# wait — racy on a near-simultaneous exit: if both are dead by the time we
# probe, the first branch always wins and mislabels the diagnostic.
REAPED_PID=""
EXIT_CODE=0
wait -n -p REAPED_PID "$AGENT_PID" "$NEXTJS_PID" || EXIT_CODE=$?
if [ "$REAPED_PID" = "$AGENT_PID" ]; then
  echo "[entrypoint] Agent (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif [ "$REAPED_PID" = "$NEXTJS_PID" ]; then
  echo "[entrypoint] Next.js (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process (PID: ${REAPED_PID:-unknown}) exited with code $EXIT_CODE"
fi

exit $EXIT_CODE
