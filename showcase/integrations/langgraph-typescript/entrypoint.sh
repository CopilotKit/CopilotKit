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
  # actually dies and frees :8123 — not just the log-pipeline subshell.
  #
  # A single snapshot-then-kill is racy: a descendant that forks a new child (or
  # a child that reparents) BETWEEN the scan and the kill is missed by the walk,
  # reparents to PID 1, and keeps :8123 bound — defeating the whole tree-kill.
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
  # PID 1, still holding :8123 across the restart.  See _kill_agent_tree.
  _kill_agent_tree "$AGENT_PID"
  # Tree-kill Next.js too: NEXTJS_PID is ALSO a process-sub subshell wrapping
  # `npx next start` (which forks npm→node), exactly like AGENT_PID.  A bare
  # `kill $NEXTJS_PID` would reap only the wrapper subshell and ORPHAN the real
  # Next.js node server — reparented to PID 1, still holding $PORT across the
  # Railway redeploy/rollover SIGTERM, so the new container cannot bind $PORT.
  # (Same orphan class already fixed for the agent; route the frontend through
  # the same guarded walk.)  WATCHDOG_PID is a genuine single-PID subshell we
  # spawn directly (`( … ) &`, not process-sub-wrapped).  It DOES fork one child
  # — the size sub-loop (SIZE_PID) — but a bare `kill $WATCHDOG_PID` is still
  # correct because the watchdog subshell arms its OWN inner EXIT trap that reaps
  # that child (a $BASHPID PPID-walk, arm-then-spawn, no leak window) whenever the
  # subshell exits, including on this SIGTERM.  So the outer cleanup only needs to
  # signal the watchdog; the watchdog cleans up its own subtree.  SIZE_PID is
  # local to the watchdog subshell and never visible here, so this outer shell
  # cannot (and need not) kill it directly.
  _kill_agent_tree "$NEXTJS_PID"
  kill $WATCHDOG_PID 2>/dev/null || true
  # NOTE: the size sub-loop is intentionally NOT killed here.  It is spawned
  # inside the watchdog subshell ( ) & so its PID is never visible in this outer
  # shell.  The watchdog subshell registers its own EXIT trap (armed BEFORE the
  # spawn) that reaps the sub-loop via a $BASHPID PPID-walk on any exit path,
  # including the SIGTERM the `kill $WATCHDOG_PID` above delivers; see the
  # "trap ... EXIT" inside the ( ) & block below.
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
  # Validate for NUMERICITY, not merely emptiness.  A non-integer value (junk
  # du output, a transient error, a test-seam stub) would otherwise reach the
  # `[ "$DIR_SIZE_MB" -ge ... ]` comparison below and throw "integer expression
  # expected".  Because that comparison sits inside an `if`, set -e is
  # suppressed and the failed test evaluates false — SILENTLY skipping the size
  # gate for this cycle with NO warning (unlike the empty-string case).  Match
  # on ^[0-9]+$ and emit the SAME "size guard inactive" WARNING so the gate can
  # never silently disappear.
  case "$DIR_SIZE_MB" in
    ''|*[!0-9]*)
      echo "[watchdog:size] WARNING: Could not read a numeric size of ${persist_dir} (got: '${DIR_SIZE_MB}') — size guard inactive this cycle"
      return 0
      ;;
  esac
  # Validate the THRESHOLD for numericity too — same set -e hazard class as
  # DIR_SIZE_MB above.  threshold_mb comes from LANGGRAPH_SIZE_THRESHOLD_MB, an
  # operator-supplied override.  A non-integer value (e.g. "200MB", "abc") would
  # otherwise reach the `[ "$DIR_SIZE_MB" -ge "$threshold_mb" ]` comparison and
  # throw "integer expression expected"; because that comparison sits inside an
  # `if`, set -e is suppressed and the failed test evaluates false — SILENTLY
  # skipping the size gate EVERY cycle with NO warning.  Match on ^[0-9]+$ and
  # emit the SAME "size guard inactive" WARNING so the gate can never silently
  # disappear behind a bad override.
  case "$threshold_mb" in
    ''|*[!0-9]*)
      echo "[watchdog:size] WARNING: LANGGRAPH_SIZE_THRESHOLD_MB is not a positive integer (got: '${threshold_mb}') — size guard inactive this cycle"
      return 0
      ;;
  esac
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
  _require_int SIZE_THRESHOLD_MB 200 "LangGraph persistence size threshold (MB)"
  # Do NOT default AGENT_PID to 0.  The old `AGENT_PID=${AGENT_PID:-0}` sentinel
  # meant that an unset/empty AGENT_PID flowed into `_kill_agent_tree "0"` →
  # `kill -9 0`, SIGKILLing the caller's ENTIRE process group.  If AGENT_PID is
  # unset/empty here, skip the check with a warning rather than defaulting to a
  # dangerous PID.  (_kill_agent_tree/_watchdog_check_size_once also fail closed
  # on PID <= 1, but we refuse earlier so no bogus PID is ever passed at all.)
  case "${AGENT_PID:-}" in
    ''|*[!0-9]*)
      echo "[watchdog:size] WARNING: AGENT_PID is unset or non-numeric (got: '${AGENT_PID:-}') — skipping size check" >&2
      exit 0
      ;;
  esac
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

# Disable @langchain/langgraph-api's FileSystemPersistence disk flush. Without
# this, the inmem runtime serialises ALL accumulated thread/run/checkpoint
# state to .langgraph_api on a 3-second timer; under D6 probe fan-out (36
# parallel probes) the dir fills past the 200MB size-watchdog threshold in
# ~90s, the watchdog kills the agent, and on rapid restart the D6 cron refills
# it and re-trips — Railway crash-loop backoff then stops restarting the
# container (the 2026-07-13 outage). Setting this env var is the TypeScript
# equivalent of the langgraph-python fix in PR #5825 (which exported the same
# LANGGRAPH_DISABLE_FILE_PERSISTENCE=true for its inmem runtime). Because the
# TS package has no built-in switch, src/agent/disable-file-persistence.mjs —
# preloaded via `node --import` in `npm start` — reads this var and no-ops the
# .langgraph_api fs writes, leaving in-memory state (the actual runtime state)
# intact. State is bounded by process memory and discarded on restart, so the
# size-watchdog has nothing to fill and never trips under probe load.
export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true

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
# pipe (`| sed …`) so `$!` (captured below as AGENT_PID) refers to the agent's
# own launch process and NOT the awk log-formatter — `wait -n $AGENT_PID` thus
# monitors the agent side, not the log pipeline.  Note `$!`/AGENT_PID is the
# WRAPPING SUBSHELL of the `... &` compound command, NOT the real npm→node
# server it forks (the server is a DESCENDANT, reached only via the tree-kill —
# see the file header and _kill_agent_tree).  Never `kill $AGENT_PID` directly:
# that reaps only the wrapper subshell and orphans the real server on :8123.
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
# Startup grace: the prod path (see above — we deliberately avoid
# `langgraph-cli dev`) still pays a heavy cold-start from the top-level
# `@langchain/langgraph-api` import (schema extraction + graph compile) that
# gates the main Hono bind on :8123. On fresh Railway containers this routinely
# exceeds the 90s (3-strike) budget introduced in PR #4116, producing the 04-20
# restart loop seen on deployment
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
# Startup grace window, steady-state health-probe interval and strike budget.
# All operator-overridable so deploy tuning does not require an image rebuild.
STARTUP_GRACE_SECONDS=${LANGGRAPH_STARTUP_GRACE_SECONDS:-180}
HEALTH_CHECK_INTERVAL=${LANGGRAPH_HEALTH_CHECK_INTERVAL:-30}
HEALTH_STRIKE_LIMIT=${LANGGRAPH_HEALTH_STRIKE_LIMIT:-3}

# ---------------------------------------------------------------------------
# Numeric-config validation pass (CLASS 1 structural guard).
#
# Validate EVERY operator-overridable numeric knob at STARTUP, before any of
# them can feed a `sleep`, a loop count, or an arithmetic test.  A bad override
# (non-integer / empty) on ANY of these would otherwise silently disable a guard
# — most dangerously LANGGRAPH_SIZE_CHECK_INTERVAL="60s", which makes the very
# first `while sleep $SIZE_CHECK_INTERVAL` fail and kills the size-monitor loop
# for the container's lifetime.  Each bad value WARNs and falls back to the
# documented default (fail-safe: never abort, never leave a guard disabled).
_require_int SIZE_THRESHOLD_MB      200 "LangGraph persistence size threshold (MB)"
_require_int SIZE_CHECK_INTERVAL     60 "LangGraph size-check interval (s)"
_require_int STARTUP_GRACE_SECONDS  180 "LangGraph startup grace window (s)"
_require_int HEALTH_CHECK_INTERVAL   30 "LangGraph health-probe interval (s)"
_require_int HEALTH_STRIKE_LIMIT      3 "LangGraph health strike limit"
(
  GRACE=$STARTUP_GRACE_SECONDS

  # Arm the size sub-loop's reaping trap BEFORE spawning it (arm-then-spawn), and
  # start the size monitor BEFORE the startup-grace loop.
  #
  # TRAP ORDERING (no-leak-window): the reaping trap is registered FIRST and does
  # not depend on SIZE_PID being assigned yet.  The previous order spawned the
  # sub-loop (`( … ) &`, SIZE_PID=$!) and only THEN registered
  # `trap 'kill "$SIZE_PID"' EXIT` — leaving a tiny window in which an outer
  # SIGTERM arriving between the `&` and the `trap` would exit this watchdog
  # subshell with NO trap armed, orphaning the size sub-loop (reparented to PID 1,
  # left spinning for the container's life).  We instead arm a trap that reaps by
  # a PPID walk of THIS subshell ($BASHPID) — it finds the sub-loop regardless of
  # whether SIZE_PID has been assigned, so cleanup no longer DEPENDS on the
  # ordering of SIZE_PID's assignment.  SIZE_PID is still captured and the
  # direct `kill "$SIZE_PID"` below is RETAINED as a belt-and-suspenders backstop
  # to the $BASHPID PPID-walk (do not remove it): if the walk ever misses the
  # sub-loop, the explicit PID kill still reaps it.
  _reap_watchdog_children() {
    local sp
    for sp in $(_agent_descendants "$BASHPID"); do
      kill "$sp" 2>/dev/null || true
    done
    [ -n "${SIZE_PID:-}" ] && kill "$SIZE_PID" 2>/dev/null || true
    return 0
  }
  trap _reap_watchdog_children EXIT

  # Size-gated restart sub-loop: periodically check the persistence dir size
  # and kill the agent if it exceeds SIZE_THRESHOLD_MB. The container restart
  # will re-run the boot-purge, clearing accumulated state safely.
  #
  # STARTED BEFORE THE GRACE LOOP (cold-start coverage): the size ceiling must be
  # guarded during the up-to-180s startup-grace window too, not only after it.
  # The previous order started this monitor only AFTER the grace loop returned,
  # so a pathological cold boot that bloats PERSIST_DIR during startup went
  # unguarded for up to 180s.  Starting it here is safe because
  # _watchdog_check_size_once already fail-closes on every not-yet-ready
  # condition: agent PID not alive (`kill -0` fails → return 0), PERSIST_DIR
  # missing (freshly purged on boot → return 0), and non-numeric/absent size or
  # threshold (WARN + return 0).  Early cycles are therefore harmless no-ops
  # until the dir exists and actually grows.
  (
    echo "[watchdog:size] Starting size-gated restart monitor (threshold=${SIZE_THRESHOLD_MB}MB, interval=${SIZE_CHECK_INTERVAL}s, dir=${PERSIST_DIR})"
    while sleep $SIZE_CHECK_INTERVAL; do
      # _watchdog_check_size_once returns:
      #   0 = no action (under threshold, dir missing, or a transient/junk read
      #       that left the guard inactive for this cycle only)
      #   1 = REAL threshold kill issued (agent tree SIGKILLed)
      # A bare `|| break` treated ANY non-zero identically, so a transient check
      # error would PERMANENTLY end the monitor for the container's lifetime.
      # Break ONLY on the real-kill signal (rc==1): after that kill the agent is
      # dead, the outer `wait -n $AGENT_PID` fires, and Railway restarts the
      # container (re-running the boot-purge) — so the monitor correctly stops.
      # For rc==0 (including transient errors, which are surfaced as a WARNING
      # inside the function) the monitor MUST stay live and re-check next cycle.
      _watchdog_check_size_once && continue
      rc=$?
      if [ "$rc" -eq 1 ]; then
        # Real kill issued — agent is terminating; stop the monitor and let the
        # container restart flow (wait -n → exit → Railway restart) proceed.
        break
      fi
      # Any other non-zero is a transient hiccup, not a kill: keep monitoring.
      echo "[watchdog:size] Size check returned transient status ${rc} — keeping monitor active"
    done
  ) &
  SIZE_PID=$!

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

  FAILS=0
  while sleep "$HEALTH_CHECK_INTERVAL"; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8124/ok > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge "$HEALTH_STRIKE_LIMIT" ]; then
        echo "[watchdog] Agent unresponsive for ~$((HEALTH_CHECK_INTERVAL * HEALTH_STRIKE_LIMIT))s — killing PID $AGENT_PID (and its npm→node tree) to trigger container restart"
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
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:8124/ok, startup grace ${STARTUP_GRACE_SECONDS}s, size-guard threshold ${SIZE_THRESHOLD_MB}MB every ${SIZE_CHECK_INTERVAL}s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first, `wait -n` would
# otherwise return with the watchdog's exit code and short-circuit before
# the agent's true exit status is observable.
#
# `|| EXIT_CODE=$?` is LOAD-BEARING under `set -e`: the PRIMARY designed exit
# path here is a NON-ZERO wait (137 = the size-gate / watchdog SIGKILL of the
# agent tree, or an agent crash).  Without the `||` guard, `set -e` aborts the
# script AT this line on exactly those interesting exits, making the entire
# "which process exited with code N" diagnostic below AND the final explicit
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
