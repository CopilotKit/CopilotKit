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
# `ps` nor `pgrep`) and SIGKILL every descendant, deepest-first, in a BOUNDED
# re-scan loop that keeps the root alive as the walk anchor until the subtree
# is drained, then kills the root last (see _kill_agent_tree for why).
#
# Defined ABOVE cleanup() on purpose: cleanup() (the EXIT/SIGTERM trap) calls
# _kill_agent_tree, so the helper must already exist whenever the trap can
# first fire — including the early `exit 1` below if the agent fails to start.
# ---------------------------------------------------------------------------
_agent_descendants() {
  # Print all descendant PIDs of $1 (children, grandchildren, …), deepest-first.
  local root="$1" pid ppid stat _state _rest
  # Fail closed on a dangerous or meaningless root.  An empty / non-numeric root
  # would make the PPID comparison below match nothing (harmless) but a root of
  # "0" or "1" is catastrophic: "0" means "every process in the caller's process
  # group" and "1" is init — a caller that then fed the result to a kill could
  # wipe the whole container.  Refuse anything that is not an integer >= 2.
  case "$root" in
    ''|*[!0-9]*) echo "[proctree] WARNING: refusing descendant scan for non-numeric root '${root}'" >&2; return 0 ;;
  esac
  if [ "$root" -le 1 ]; then
    echo "[proctree] WARNING: refusing descendant scan for reserved root ${root} (0=process-group, 1=init)" >&2
    return 0
  fi
  for pid in $(cd /proc 2>/dev/null && ls -d [0-9]* 2>/dev/null); do
    [ -r "/proc/$pid/stat" ] || continue
    # /proc/PID/stat is: "PID (comm) STATE PPID PGRP …". comm can contain
    # spaces AND parens, so strip through the final ") " before splitting; PPID
    # is then the 2nd field of the remainder (1st is STATE). "${x##*) }" takes
    # the LONGEST prefix up to the LAST ") ", and no field after the real
    # closing paren contains ")", so even a comm like "(evil) S 1)" parses to
    # the true PPID — the last ") " is always the comm's real terminator.
    stat=$(cat "/proc/$pid/stat" 2>/dev/null) || continue
    # The remainder after the comm's terminating ") " is "STATE PPID PGRP …", so
    # PPID is the 2nd whitespace-separated field.  Use the `read` builtin instead
    # of `echo … | awk` to avoid forking awk once per /proc entry (a fork-storm
    # under a large process table).  `read` word-splits on IFS; discard STATE
    # into _state, capture PPID, discard the rest into _rest.
    read -r _state ppid _rest <<< "${stat##*) }"
    if [ "$ppid" = "$root" ]; then
      _agent_descendants "$pid"
      echo "$pid"
    fi
  done
}

_kill_agent_tree() {
  # SIGKILL the agent subshell AND its npm→node descendants so the real server
  # actually dies and frees :8000 — not just the log-pipeline subshell.
  #
  # A single snapshot-then-kill is racy: a descendant that forks a new child (or
  # a child that reparents) BETWEEN the scan and the kill is missed by the walk,
  # reparents to PID 1, and keeps :8000 bound — defeating the whole tree-kill.
  # So we re-scan in a BOUNDED loop, killing the currently-live descendants
  # deepest-first each pass, until a scan comes back empty (or the bound is
  # hit). Crucially we keep the ROOT alive as the walk anchor across passes and
  # kill it LAST: killing root first would immediately reparent every descendant
  # to PID 1, making them unreachable by a root-anchored PPID walk. Leaving root
  # alive (it is an idle subshell that spawns nothing on its own) means a child
  # that forks between two passes is still attached to a live chain from root
  # and is reaped on the next pass.
  #
  # Residual limitation: a descendant that FULLY reparents to PID 1 (double-fork
  # / daemonize) before we reach it is no longer on any PPID chain from root and
  # cannot be found by a /proc PPID walk. That is inherent to PPID-based reaping
  # without job control (no ps/pgrep in node:22-slim; job control off in a
  # non-interactive script, so no process-group kill). The agent's npm→node tree
  # does not daemonize, so this loop covers the real failure surface.
  #
  # Fail closed on a dangerous or meaningless root, BEFORE any kill runs.  If the
  # caller passes an empty / non-numeric PID, or the reserved 0 (SIGKILL to the
  # WHOLE caller process group) or 1 (init), refuse outright — a bare `kill -9 0`
  # here would SIGKILL the entire entrypoint.  This makes `kill -9 0`/`kill -9 1`
  # structurally impossible regardless of what the caller passes.
  local root="$1" p descendants
  case "$root" in
    ''|*[!0-9]*) echo "[proctree] WARNING: refusing tree-kill for non-numeric PID '${root}'" >&2; return 0 ;;
  esac
  if [ "$root" -le 1 ]; then
    echo "[proctree] WARNING: refusing tree-kill for reserved PID ${root} (0=process-group, 1=init)" >&2
    return 0
  fi
  for _ in 1 2 3 4 5; do
    descendants=$(_agent_descendants "$root")
    [ -z "$descendants" ] && break
    for p in $descendants; do
      kill -9 "$p" 2>/dev/null || true
    done
    # `|| true`: under set -e a non-zero `sleep` (e.g. a future busybox/Alpine
    # rebase whose sleep can fail) would abort this tree-kill mid-walk, leaving
    # the root un-killed and the real npm→node server orphaned.  The guard keeps
    # the walk running to completion regardless of sleep's exit status.
    sleep 0.2 || true
  done
  kill -9 "$root" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Numeric-config validator.
#
# Every operator-overridable numeric knob (size threshold, check intervals,
# strike budgets, grace/timeout windows) is read from an env var with a `:-`
# default.  A non-integer or empty override (e.g. LANGGRAPH_SIZE_CHECK_INTERVAL
# ="60s") does NOT fall back to the default on its own — it propagates as a bad
# value into an arithmetic test (`[ .. -ge .. ]`), a `sleep`, or a loop count.
# Under `set -e` those failures are inconsistent: a bad `sleep $INTERVAL` makes
# the size-monitor loop exit on its FIRST iteration, silently disabling the
# whole size guard for the container's lifetime; a bad arithmetic test inside an
# `if` evaluates false and skips the guard with no warning.  Either way an
# operator typo silently DISABLES a guard.
#
# _require_int validates ONE such var by name and rewrites it in place: if the
# current value is a positive integer it is kept; otherwise a WARNING is logged
# and the documented default is substituted.  It fails SAFE — it never aborts
# and never leaves a guard fed by a bad value.  Run over EVERY numeric config
# var at startup (see the validation pass below) so no `sleep`/loop-count/
# arithmetic test downstream can be silently broken by a bad override.
#
# Args: $1 = variable NAME (validated + reassigned via printf -v)
#       $2 = documented default (used verbatim on fallback)
#       $3 = human label for the warning
_require_int() {
  local name="$1" default="$2" label="$3" value
  eval "value=\${$name}"
  # Valid ONLY if a positive integer with no leading zero: first digit 1-9,
  # rest digits ([1-9][0-9]*).  This rejects — and falls back to the default
  # for — every operator-typo class that would break a guard:
  #   • empty / non-numeric ("", "60s", "abc")
  #   • "0" — a zero threshold/interval/limit turns a guard into an instant-fire
  #     kill loop (SIZE_THRESHOLD_MB=0 kills on cycle 1) or a busy-spin
  #     (SIZE_CHECK_INTERVAL=0 → `while sleep 0`)
  #   • leading-zero / octal forms ("010", "08") — bash arithmetic reads a
  #     leading-zero literal as OCTAL, so "010" becomes 8 (wrong value) and an
  #     "08"/"09" digit aborts the script under `set -e` ("value too great for
  #     base").
  # The `[1-9]*([0-9])` extglob-free equivalent is written as two arms: a lone
  # single digit 1-9, or a 1-9 lead followed by one-or-more digits.
  #
  # UPPER BOUND (fail-safe, same class as the checks above): even a value that is
  # syntactically all-digits can be pathologically large.  bash arithmetic is
  # signed 64-bit, so a 19-digit value can still parse but a 20+ digit value
  # OVERFLOWS — `[ "$x" -ge "$y" ]` then aborts with "value too great for base"
  # (suppressed to false inside an `if`, silently disabling the guard) or wraps
  # to a negative/garbage magnitude.  No real knob (interval seconds, strike
  # count, size-MB threshold) is ever more than a handful of digits, so cap the
  # length at 10 digits (max 9,999,999,999 — years of seconds, petabytes of MB;
  # comfortably inside the signed-64-bit range with no overflow risk).  A longer
  # value is treated exactly like any other bad override: WARN + fall back to the
  # documented default rather than silently disabling the guard.
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

cleanup() {
  # Tree-kill the agent (not a bare `kill $AGENT_PID`): $AGENT_PID is the
  # process-sub subshell, so a single-PID kill on the normal shutdown path
  # (graceful exit / SIGTERM on every Railway redeploy/rollover) would reap
  # only the subshell and ORPHAN the real npm→node server — reparented to
  # PID 1, still holding :8000 across the restart.  See _kill_agent_tree.
  _kill_agent_tree "$AGENT_PID"
  # Tree-kill Next.js too: NEXTJS_PID is ALSO a process-sub subshell wrapping
  # `npx next start` (which forks npm→node), exactly like AGENT_PID.  A bare
  # `kill $NEXTJS_PID` would reap only the wrapper subshell and ORPHAN the real
  # Next.js node server — reparented to PID 1, still holding $PORT across the
  # Railway redeploy/rollover SIGTERM, so the new container cannot bind $PORT.
  # (Same orphan class already fixed for the agent; route the frontend through
  # the same guarded walk.)  WATCHDOG_PID is a genuine single-PID subshell we
  # spawn directly (`( … ) &`, not process-sub-wrapped) that forks nothing that
  # outlives it, so a bare kill is correct for it.
  _kill_agent_tree "$NEXTJS_PID"
  kill $WATCHDOG_PID 2>/dev/null || true
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
# substitution (`&> >(awk …)`) rather than a pipe so `$!` (captured below as
# AGENT_PID) refers to the agent's own launch process and NOT the awk log-
# formatter — `wait -n $AGENT_PID` thus monitors the agent side, not the log
# pipeline. Note `$!`/AGENT_PID is the WRAPPING SUBSHELL of the `... &` compound
# command, NOT the real npm→node server it forks (the server is a DESCENDANT,
# reached only via the tree-kill — see the file header and _kill_agent_tree).
# Never `kill $AGENT_PID` directly: that reaps only the wrapper subshell and
# orphans the real server on :8000.
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
#
# Startup grace: the Strands TS agent does a tsx cold-start (one-shot ESM
# compile of server.ts + imports on first boot). On fresh Railway containers
# this can exceed the 90s (3-strike) budget, and — now that the agent kill is
# effective via the process-tree walk above (previously the orphan bug made it
# cosmetic) — a slow boot would be genuinely killed and enter a restart loop.
# Wait up to 180s for the first healthy /health probe before arming the strike
# counter; if /health comes up sooner, fall through immediately. If 180s
# elapses without success, arm the counter anyway — the steady-state watchdog
# will handle a true hang. Mirrors langgraph-typescript/entrypoint.sh.
#
# Startup grace window, steady-state health-probe interval and strike budget.
# All operator-overridable so deploy tuning does not require an image rebuild.
STARTUP_GRACE_SECONDS=${STRANDS_STARTUP_GRACE_SECONDS:-180}
HEALTH_CHECK_INTERVAL=${STRANDS_HEALTH_CHECK_INTERVAL:-30}
HEALTH_STRIKE_LIMIT=${STRANDS_HEALTH_STRIKE_LIMIT:-3}

# ---------------------------------------------------------------------------
# Numeric-config validation pass (CLASS 1 structural guard).
#
# Validate EVERY operator-overridable numeric knob at STARTUP, before any of
# them can feed a `sleep`, a loop count, or an arithmetic test.  A bad override
# (non-integer / empty) on ANY of these would otherwise silently disable a guard
# — e.g. STRANDS_HEALTH_CHECK_INTERVAL="30s" makes the very first
# `while sleep $HEALTH_CHECK_INTERVAL` fail and kills the health monitor loop
# for the container's lifetime.  Each bad value WARNs and falls back to the
# documented default (fail-safe: never abort, never leave a guard disabled).
_require_int STARTUP_GRACE_SECONDS  180 "Strands startup grace window (s)"
_require_int HEALTH_CHECK_INTERVAL   30 "Strands health-probe interval (s)"
_require_int HEALTH_STRIKE_LIMIT      3 "Strands health strike limit"
(
  GRACE=$STARTUP_GRACE_SECONDS
  echo "[watchdog] Startup grace: waiting up to ${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
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
    if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge "$HEALTH_STRIKE_LIMIT" ]; then
        echo "[watchdog] Agent unresponsive for ~$((HEALTH_CHECK_INTERVAL * HEALTH_STRIKE_LIMIT))s — killing PID $AGENT_PID (and its npm→node tree) to trigger container restart"
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

echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:8000/health, startup grace ${STARTUP_GRACE_SECONDS}s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog.
#
# `|| EXIT_CODE=$?` is LOAD-BEARING under `set -e`: the PRIMARY designed exit
# path here is a NON-ZERO wait (137 = the watchdog SIGKILL of the agent tree,
# or an agent crash).  Without the `||` guard, `set -e` aborts the script AT
# this line on exactly those interesting exits, making the entire "which
# process exited with code N" diagnostic below AND the final explicit
# `exit $EXIT_CODE` dead code — the container still restarts (EXIT trap runs
# cleanup, script exits non-zero) but the operator-facing diagnostic never
# prints.  Capturing the code preserves it exactly (incl. 137) for both the
# diagnostic and the final exit, and the container-restart path is unchanged.
#
# REAPED_PID via `wait -n -p VAR` (bash >= 5.1; node:22-slim ships 5.2) captures
# the ACTUAL PID `wait -n` reaped.  The previous `kill -0` if/elif merely INFERRED
# which process exited by probing liveness AFTER the wait — racy on a near-
# simultaneous exit: if both are dead by the time we probe, the first `kill -0`
# branch always wins and mislabels the diagnostic (e.g. reports the agent when
# Next.js is what actually exited, attaching the wrong code to the wrong name).
# Keying the message off the reaped PID names the correct process every time.
# `|| EXIT_CODE=$?` remains LOAD-BEARING (see above): -p does not change that a
# non-zero wait would abort under set -e without the guard.
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
