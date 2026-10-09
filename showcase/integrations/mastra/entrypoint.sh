#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# mastra runs TWO processes in this container:
#
#   1. the standalone AG-UI agent server (src/agent_server.ts) on :8000, and
#   2. the Next.js frontend on $PORT.
#
# This mirrors strands-typescript's container. The Next.js half is INTENTIONALLY
# still here: its /api/copilotkit route still runs the Mastra agents in-process,
# exactly as before, so the demos behave identically today. A later phase drops
# the Next.js half and leaves only the agent server — that is why the agent
# binds AGENT_PORT (default 8000) and NOT $PORT: binding $PORT now would collide
# with Next.js and break the container.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Log prefixing: a bash `while read` loop, NOT `awk`.  CANONICAL EXPLANATION —
# the other showcase entrypoints carry a one-line summary and point here.
#
# Every long-lived child in these containers is launched as
#
#   <command> &> >(while IFS= read -r line; do printf '[tag] %s\n' "$line"; done) &
#
# — all nineteen two-process entrypoints, spring-ai included.  The one file with
# no prefixer is built-in-agent, and it has no long-lived CHILD to prefix: it
# `exec`s Next.js, which REPLACES the shell, so its output already reaches
# `docker logs` unambiguously (there is nothing else in the container to confuse
# it with).
#
# It used to be `&> >(awk '{print "[tag] " $0; fflush()}')`, and that printed
# NOTHING for the long-lived children.  The images ship mawk 1.3.4, which
# block-buffers its INPUT; `fflush()` flushes OUTPUT, so it cannot help — awk
# has not even read the record yet.  The agent and Next.js run for the whole
# life of the container, so awk's input buffer only fills at EOF, and the
# tree-kill below SIGKILLs awk before EOF ever arrives — the buffer is
# discarded and those lines are lost for good.  Verified in a real container:
# zero [agent] and zero [nextjs] lines before, 9 and 8 after.
#
# The `while IFS= read -r line` loop reads and prints ONE line at a time with
# no input buffer, so each line reaches `docker logs` as it is produced.
# `mawk -W interactive` would also unbuffer the input, but it is mawk-specific
# and hard-fails on gawk, which other base images ship — the loop is portable
# and needs no external binary at all.
#
# DO NOT "simplify" this back to awk.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Agent process-tree kill.
#
# The agent is launched by exactly this line (see the launch site below):
#
#   AGENT_PORT=$AGENT_PORT AGENT_HOST=0.0.0.0 npm run agent &> >(while read …) &
#
# That is a SIMPLE COMMAND with two assignment prefixes and a `&>` redirection
# into a process substitution — NOT a pipeline and NOT a compound command, so
# bash forks ONCE and execs `npm` in that child.  $AGENT_PID (=$!) is therefore
# the `npm` WRAPPER PROCESS itself.  (The `>(while read …)` substitution runs
# the prefixer in a separate child of its own, which is the whole point of using
# `&>` instead of a pipe: `$!` names the agent's launcher, not the log
# formatter.)
#
# The real chain is:  npm (=$AGENT_PID)  →  sh -c  →  node --import tsx
# src/agent_server.ts, and it is the `node` at the end that binds :8000.  A plain
# `kill -9 $AGENT_PID` reaps only `npm`: `sh` and `node` are reparented to PID 1
# and KEEP RUNNING — still bound to :8000.  The watchdog's whole promise
# ("kill agent → wait -n returns → container restart") is then broken: the
# frontend proxies to a dead-but-not-restarted agent forever (edge 502s), and
# even if the container does exit, a surviving orphan can still hold :8000
# across the restart.
#
# We cannot `kill -- -$PGID` because a non-interactive script has job control
# OFF: npm, node, next.js AND the main shell all share the
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
    # The remainder after the comm's terminating ") " is "STATE PPID PGRP …", so
    # PPID is the 2nd whitespace-separated field.  Same reason as above: use the
    # `read` builtin rather than `echo … | awk`, so no external process is
    # spawned per /proc entry.  `read` word-splits on IFS; discard STATE into
    # _state, capture PPID, discard the rest into _rest.
    read -r _state ppid _rest <<< "${stat##*) }"
    if [ "$ppid" = "$root" ]; then
      _agent_descendants "$pid"
      echo "$pid"
    fi
  done
}

_kill_agent_tree() {
  # SIGKILL the root process AND all of its descendants so the real server
  # actually dies and frees :8000 — not just the `npm` wrapper at the root.
  #
  # A single snapshot-then-kill is racy: a descendant that forks a new child (or
  # a child that reparents) BETWEEN the scan and the kill is missed by the walk,
  # reparents to PID 1, and keeps :8000 bound — defeating the whole tree-kill.
  # So we re-scan in a BOUNDED loop, killing the currently-live descendants
  # deepest-first each pass, until a scan comes back empty (or the bound is
  # hit). Crucially we keep the ROOT alive as the walk anchor across passes and
  # kill it LAST: killing root first would immediately reparent every descendant
  # to PID 1, making them unreachable by a root-anchored PPID walk. Leaving root
  # alive means a child that forks between two passes is still attached to a live
  # chain from root and is reaped on the next pass.
  #
  # Re-checked against root actually being `npm` (see the header — it is NOT an
  # idle subshell): the rationale still holds, for a narrower reason. `npm run`
  # forks its `sh -c` child ONCE at startup and does not respawn it, so a live
  # `npm` cannot repopulate the subtree we are draining. The residual risk is the
  # reverse one — `npm` may EXIT on its own once its child is SIGKILLed, so the
  # anchor can disappear mid-walk. That is benign here: by then every descendant
  # has already been killed, the next `_agent_descendants` pass comes back empty,
  # and the final `kill -9 "$root"` is a no-op guarded by `|| true`. It does
  # leave a theoretical PID-reuse window (root exits, the PID is recycled, the
  # final kill hits the new owner), which needs the kernel to wrap the whole PID
  # space inside the loop's ~1s and is not defensible against without a
  # pidfd — noted rather than pretended away.
  #
  # Residual limitation: a descendant that FULLY reparents to PID 1 (double-fork
  # / daemonize) before we reach it is no longer on any PPID chain from root and
  # cannot be found by a /proc PPID walk. That is inherent to PPID-based reaping
  # without job control (no ps/pgrep in node:22-slim; job control off in a
  # non-interactive script, so no process-group kill). The agent's npm→sh→node
  # tree does not daemonize, so this loop covers the real failure surface.
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
# Every operator-overridable numeric knob (check intervals, strike budgets,
# grace windows) is read from an env var with a `:-` default.  A non-integer or
# empty override (e.g. MASTRA_HEALTH_CHECK_INTERVAL="60s") does NOT fall back to
# the default on its own — it propagates as a bad value into an arithmetic test
# (`[ .. -ge .. ]`), a `sleep`, or a loop count.  Under `set -e` those failures
# are inconsistent: a bad `sleep $INTERVAL` makes the monitor loop exit on its
# FIRST iteration, silently disabling the whole guard for the container's
# lifetime; a bad arithmetic test inside an `if` evaluates false and skips the
# guard with no warning.  Either way an operator typo silently DISABLES a guard.
#
# _require_int validates ONE such var by name and rewrites it in place: if the
# current value is a positive integer it is kept; otherwise a WARNING is logged
# and the documented default is substituted.  It fails SAFE — it never aborts
# and never leaves a guard fed by a bad value.
#
# Args: $1 = variable NAME (validated + reassigned via printf -v)
#       $2 = documented default (used verbatim on fallback)
#       $3 = human label for the warning
_require_int() {
  local name="$1" default="$2" label="$3" value bad=""
  eval "value=\${$name}"
  # Valid ONLY if a positive integer with no leading zero: first digit 1-9,
  # rest digits ([1-9][0-9]*).  This rejects — and falls back to the default
  # for — every operator-typo class that would break a guard:
  #   • empty / non-numeric ("", "60s", "abc")
  #   • "0" — a zero interval/limit turns a guard into an instant-fire kill loop
  #     or a busy-spin (INTERVAL=0 → `while sleep 0`)
  #   • leading-zero / octal forms ("010", "08") — bash arithmetic reads a
  #     leading-zero literal as OCTAL, so "010" becomes 8 (wrong value) and an
  #     "08"/"09" digit aborts the script under `set -e`.
  #   • more than 10 digits — see the UPPER BOUND note below.
  #
  # DIGIT SHAPE FIRST, LENGTH SECOND.  The length test used to run BEFORE the
  # shape test, which misdiagnosed every LONG NON-NUMERIC value as a magnitude
  # problem: MASTRA_HEALTH_CHECK_INTERVAL="four hours please" was reported as
  # "too large (17 digits — max 10)", sending the operator hunting for a number
  # that is too big inside a value holding no digits at all.  Only an all-digit
  # value can be too large, so the length test belongs after the shape test.
  # Same ordering, and the same reason, as `_require_positive_int` in
  # showcase/scripts/cli/_common.sh.
  case "$value" in
    [1-9]) ;;                  # single positive digit
    [1-9][0-9]*)               # multi-digit, must be all digits after the lead
      case "$value" in
        *[!0-9]*) bad="not a positive integer" ;;
      esac
      ;;
    *) bad="not a positive integer" ;;
  esac
  # UPPER BOUND (fail-safe, same class as the checks above).  This is NOT the
  # overflow point: bash arithmetic is signed 64-bit, which holds 19 digits, so
  # `[ 99999999999 -ge 5 ]` (11 digits) evaluates just fine.  10 is a
  # deliberately CONSERVATIVE cap — no real knob (an interval, a strike budget,
  # a grace window, a port) is ever more than a handful of digits, so anything
  # longer is a paste accident, and refusing it early keeps a genuinely
  # unrepresentable 20+ digit value from ever reaching an arithmetic test, where
  # it would abort with "value too great for base" (suppressed to false inside
  # an `if`, silently disabling the guard) or wrap to garbage.
  if [ -z "$bad" ] && [ "${#value}" -gt 10 ]; then
    bad="too large (${#value} digits — max 10)"
  fi
  if [ -n "$bad" ]; then
    echo "[entrypoint] WARNING: ${label} (${name}) is ${bad} (got: '${value}') — falling back to default ${default}"
    printf -v "$name" '%s' "$default"
  fi
}

# Process handles the EXIT/SIGTERM trap reads. Declared (empty) BEFORE the trap
# is installed because cleanup() can fire on a path where some of them are not
# assigned yet — most importantly the `exit 1` below when the agent fails to
# start, which happens before Next.js and the watchdog exist. With them unset,
# cleanup() printed "[proctree] WARNING: refusing tree-kill for non-numeric PID
# ''" plus a swallowed `kill` usage error, burying the one line an operator
# needs in the Railway log ("ERROR: Agent server failed to start"). The guards
# in cleanup() skip each kill whose handle is still empty, so the shutdown path
# stays silent about processes that were never started.
AGENT_PID=""
NEXTJS_PID=""
WATCHDOG_PID=""

# Set once cleanup() has run, so it cannot run twice. With a single
# `trap cleanup EXIT INT TERM`, a SIGTERM ran cleanup for the TERM trap, then
# bash exited and ran it AGAIN for the EXIT trap — two full /proc walks per
# shutdown, on the normal Railway redeploy path. Observed in a real container.
_CLEANED=0

cleanup() {
  if [ "$_CLEANED" = "1" ]; then
    return 0
  fi
  _CLEANED=1
  # Tree-kill the agent (not a bare `kill $AGENT_PID`): $AGENT_PID is the `npm`
  # WRAPPER, so a single-PID kill on the normal shutdown path (graceful exit /
  # SIGTERM on every Railway redeploy/rollover) would reap only `npm` and ORPHAN
  # the real `node` server underneath it — reparented to PID 1, still holding
  # :8000 across the restart.  See _kill_agent_tree.
  if [ -n "$AGENT_PID" ]; then
    _kill_agent_tree "$AGENT_PID"
  fi
  # Tree-kill Next.js too: NEXTJS_PID is the `npx next start` process (which
  # forks the real Next.js `node` server as a child), exactly the same shape as
  # AGENT_PID — a wrapper at the root of a tree, not a subshell.  A bare
  # `kill $NEXTJS_PID` would reap only `npx` and ORPHAN that node server —
  # reparented to PID 1, still holding $PORT across the Railway
  # redeploy/rollover SIGTERM, so the new container cannot bind $PORT.
  # WATCHDOG_PID is the one handle that really IS a subshell: it is spawned as
  # `( … ) &`, and it forks nothing that outlives it, so a bare kill is correct
  # for it.
  if [ -n "$NEXTJS_PID" ]; then
    _kill_agent_tree "$NEXTJS_PID"
  fi
  if [ -n "$WATCHDOG_PID" ]; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
  fi
  # Explicit success. With every handle empty (the agent-failed-to-start path)
  # the last `if` evaluates false, so cleanup() would return non-zero. Bash
  # keeps the pre-trap exit status, so that does not change the script's exit
  # code today — but this trap also runs on INT/TERM and under `set -e`, and a
  # function that reports failure purely because it had nothing to kill is a
  # trap waiting for the next edit. Pin it to 0.
  return 0
}
# EXIT alone does NOT cover SIGTERM. An untrapped SIGTERM kills bash BY SIGNAL,
# and bash does not run the EXIT trap in that case — so on a Railway
# redeploy/rollover (which is exactly a SIGTERM) cleanup never ran and the real
# npm→node agent server was orphan-reparented to PID 1, still holding :8000
# across the restart. That is the precise scenario this whole tree-kill
# apparatus exists to prevent, so the signals must be trapped explicitly.
#
# SEPARATE SIGNAL AND EXIT TRAPS. spring-ai, strands and langgraph-python are
# the only three files that carry the same idea in a slightly shorter shape (one
# `trap _on_signal INT TERM`, unconditional 143); splitting INT from TERM here
# lets the handler report 130 vs 143. Every other entrypoint uses this file's
# three-trap shape, EXCEPT built-in-agent, which carries no traps at all and
# needs none: it is a single `exec env NODE_ENV=production npx next start`, so
# Next.js REPLACES the shell and receives the platform's SIGTERM directly —
# there is no shell left to trap it and no second child to reap.
# langgraph-typescript, ms-agent-dotnet and strands-typescript match this file's
# shutdown apparatus, /proc tree walk included — same three traps, the same
# descendant PPID walk with the clear-then-test `read` guard, and the same
# bounded root-last tree-kill. (ms-agent-dotnet spells the two helpers
# `_process_descendants` / `_kill_process_tree` because it kills a dotnet tree
# as well as an npx→node one; the bodies are the same.) They are not
# byte-identical FILES — langgraph-typescript also carries a persistence size
# gate, and each names its own knobs; it is the shutdown apparatus that matches.
# The remaining ones (ag2, agno,
# claude-sdk-python, claude-sdk-typescript, crewai-crews, google-adk,
# langgraph-fastapi, langroid, llamaindex, ms-agent-harness-dotnet,
# ms-agent-python, pydantic-ai) share the traps but kill their direct child pids
# instead of walking /proc. That is a real remaining gap, not a design choice:
# their NEXTJS_PID is an `npx next start` wrapper that can fork the server, so
# they carry the same orphan risk this walk exists to remove. spring-ai, strands
# and langgraph-python state that limitation in their own headers.
# A single `trap cleanup EXIT INT TERM` left the signal path
# falling back into the script: `wait -n` was INTERRUPTED rather
# than reaping a child, so `wait -n -p REAPED_PID` never assigned REAPED_PID and
# the diagnostic below printed "A process (PID: unknown) exited with code 143"
# on every clean SIGTERM. That reads as an anomaly in the Railway log for what
# is the ordinary redeploy path. Handling the signal and exiting inside the
# handler means the diagnostic is only ever reached when a child really did die
# on its own — the only case it can describe truthfully.
_on_signal() {
  echo "[entrypoint] Received shutdown signal — terminating children"
  cleanup
  # 128 + signal number, the shell convention, so the container's exit status
  # still says WHICH signal stopped it. `docker stop` sends TERM, so 143 —
  # unchanged from the previous behaviour, which a real container confirmed.
  case "$1" in
    INT) exit 130 ;;
    *) exit 143 ;;
  esac
}
trap '_on_signal INT' INT
trap '_on_signal TERM' TERM
trap cleanup EXIT

# Agent bind port.  DELIBERATELY NOT $PORT — Next.js owns $PORT in this
# container (see the header).  AGENT_PORT is unset in every deployment today,
# so this resolves to 8000, matching src/agent_server.ts's own default and the
# port every other showcase agent process uses.
AGENT_PORT=${AGENT_PORT:-8000}
_require_int AGENT_PORT 8000 "Mastra agent port"

echo "========================================="
echo "[entrypoint] Starting showcase package: mastra"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set} (Next.js)"
echo "[entrypoint] AGENT_PORT=${AGENT_PORT} (AG-UI agent server)"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

# Start the standalone AG-UI agent server.
# `npm run agent` runs `node --import tsx src/agent_server.ts` (see
# package.json). tsx is a one-shot ESM loader here (NOT a watcher) so
# agent_server.ts, its imports and the tsconfig `@/*` path alias resolve
# without a precompile step. Log prefixing uses bash process substitution
# (`&> >(while read …)`) rather than a pipe so `$!` (captured below as
# AGENT_PID) refers to the agent's own launch process and NOT the log-formatter.
# The prefixer is a `while read` loop and NOT `awk` — see the file header for
# why (mawk block-buffers its input, so `fflush()` could not help).
# Note `$!`/AGENT_PID is the `npm` PROCESS ITSELF — this line is a simple command
# with assignment prefixes, so bash forks once and execs npm — and NOT the real
# `node` server npm forks underneath it (the server is a DESCENDANT, reached only
# via the tree-kill — see the file header and _kill_agent_tree).
# Never `kill $AGENT_PID` directly: that reaps only the npm wrapper and orphans
# the real server on :$AGENT_PORT.
echo "[entrypoint] Starting mastra AG-UI agent on port ${AGENT_PORT}..."
AGENT_PORT=$AGENT_PORT AGENT_HOST=0.0.0.0 npm run agent &> >(while IFS= read -r line; do printf '[agent] %s\n' "$line"; done) &
AGENT_PID=$!
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
env NODE_ENV=production npx next start --port $PORT &> >(while IFS= read -r line; do printf '[nextjs] %s\n' "$line"; done) &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the process stays alive (so `wait -n` never fires and the
# container never restarts) but stops responding. Poll /health; after N
# consecutive failures, kill the agent so `wait -n` returns and Railway restarts
# the container.
#
# Startup grace: the agent does a tsx cold-start (one-shot ESM compile of
# agent_server.ts + the whole Mastra agent graph on first boot). On fresh
# containers this can exceed the steady-state strike budget, and — since the
# agent kill is effective via the process-tree walk above — a slow boot would be
# genuinely killed and enter a restart loop. Wait up to the grace window for the
# first healthy /health probe before arming the strike counter; if /health comes
# up sooner, fall through immediately. Mirrors strands-typescript.
#
# Both budgets are FLOORS, not exact durations. Every probe below is
# `curl --max-time 5`, so a probe that hangs adds up to 5s that neither the
# grace loop's `ELAPSED` (it only counts its own `sleep 5`) nor the strike
# arithmetic accounts for. Read the grace window as "at least
# STARTUP_GRACE_SECONDS" and the strike budget as "at least
# interval*strikes, plus up to 5s per failed probe".
#
# All three knobs are operator-overridable so deploy tuning does not require an
# image rebuild.
STARTUP_GRACE_SECONDS=${MASTRA_STARTUP_GRACE_SECONDS:-180}
HEALTH_CHECK_INTERVAL=${MASTRA_HEALTH_CHECK_INTERVAL:-30}
HEALTH_STRIKE_LIMIT=${MASTRA_HEALTH_STRIKE_LIMIT:-3}

# Numeric-config validation pass (CLASS 1 structural guard). Validate EVERY
# operator-overridable numeric knob at STARTUP, before any of them can feed a
# `sleep`, a loop count, or an arithmetic test. Each bad value WARNs and falls
# back to the documented default (fail-safe: never abort, never leave a guard
# disabled).
_require_int STARTUP_GRACE_SECONDS  180 "Mastra startup grace window (s)"
_require_int HEALTH_CHECK_INTERVAL   30 "Mastra health-probe interval (s)"
_require_int HEALTH_STRIKE_LIMIT      3 "Mastra health strike limit"
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
        # `interval * strikes` is a LOWER bound, not the elapsed time: each
        # failed probe can additionally burn up to the `curl --max-time 5`
        # timeout before it is counted, so the true wall clock is
        # interval*strikes plus up to 5s per strike. Hence "at least".
        echo "[watchdog] Agent unresponsive for at least ~$((HEALTH_CHECK_INTERVAL * HEALTH_STRIKE_LIMIT))s (plus up to 5s per failed probe) — killing PID $AGENT_PID (and its npm→node tree) to trigger container restart"
        # Tree-kill (not a bare `kill -9 $AGENT_PID`): $AGENT_PID is the `npm`
        # wrapper, so a single-PID kill would orphan the real `node` server it
        # forked, leaving the port bound to a hung agent that `wait -n` never
        # observes dying.
        _kill_agent_tree "$AGENT_PID"
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!

echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:${AGENT_PORT}/health, startup grace ${STARTUP_GRACE_SECONDS}s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog.
#
# `|| EXIT_CODE=$?` is LOAD-BEARING under `set -e`: the PRIMARY designed exit
# path here is a NON-ZERO wait (137 = the watchdog SIGKILL of the agent tree,
# or an agent crash).  Without the `||` guard, `set -e` aborts the script AT
# this line on exactly those interesting exits, making the entire "which
# process exited with code N" diagnostic below AND the final explicit
# `exit $EXIT_CODE` dead code.
#
# REAPED_PID via `wait -n -p VAR` (bash >= 5.1; node:22-slim ships 5.2) captures
# the ACTUAL PID `wait -n` reaped, so the diagnostic names the correct process
# even when both die near-simultaneously.
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
