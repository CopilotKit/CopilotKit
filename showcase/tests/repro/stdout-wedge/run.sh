#!/usr/bin/env bash
# RED repro driver for the stdout-backpressure event-loop wedge.
#
# Runs the faithful topology on real Linux (via Docker), exercising the exact
# load-bearing mechanism from the production incident:
#
#   server.mjs (single event loop, blocking fd1)
#     |  &> >(awk '{print "[nextjs] " $0; fflush()}')   <-- same as entrypoint.sh:58
#     |
#     v  awk (line-prefix + fflush)
#     |
#     v  reader.mjs  (rate-capped ~CAP lines/TICK — models Railway 500/sec cap)
#
# While the flood fills the pipe, we poll GET /health (the static, log-free
# route) and sample CPU/state from /proc, proving:
#   fast 200  ->  timeout/502 (event loop wedged in write(2))  while CPU -> 0.
#
# Usage:  ./run.sh            (runs in Docker node:22-slim — recommended, real Linux)
#         RUNNER=local ./run.sh   (runs on the host — see README caveat for macOS)
#
# Transcript is printed AND saved to the path in $TRANSCRIPT (default
# /tmp/stdout-wedge-red.txt).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${RUNNER:-docker}"
# FIXED lane (GREEN-1): model the post-fix stdout rate (CVDIAG breadcrumb +
# uvicorn access line removed, only residual sub-cap volume). Default 0 = RED.
#
# CANONICAL FIXED PREDICATE (must be byte-identical with server.mjs):
#   FIXED is true IFF the lowercased value is exactly "1" or "true".
# Any other value (e.g. "yes", "0", "false", "", "on") is RED. This closes the
# false-GREEN hole where run.sh would LABEL the run GREEN while server.mjs ran
# the RED flood (divergent truthiness).
FIXED="${FIXED:-0}"
FIXED_LC="$(printf '%s' "$FIXED" | tr '[:upper:]' '[:lower:]')"
if [ "$FIXED_LC" = "1" ] || [ "$FIXED_LC" = "true" ]; then
  IS_FIXED=1
  TRANSCRIPT="${TRANSCRIPT:-/tmp/stdout-wedge-green-must1.txt}"
  LANE="GREEN (fixed-volume)"
else
  IS_FIXED=0
  TRANSCRIPT="${TRANSCRIPT:-/tmp/stdout-wedge-red.txt}"
  LANE="RED"
fi
IMAGE="${IMAGE:-node:22-slim}"
# Probe the port the server actually binds ($PORT, default 9099). Unset PORT in
# the workload env below so an inherited PORT can't desync the local lane; the
# server then also falls back to 9099. FIX-2b: closes the false-RED where the
# driver probes 9099 but the server bound an inherited $PORT.
PROBE_PORT="${PORT:-9099}"
export FIXED IS_FIXED PROBE_PORT

# Tunables (defaults chosen to wedge reliably on Linux with a ~64KB pipe).
CAP="${CAP:-50}"          # reader drains this many lines per TICK
TICK="${TICK:-1000}"      # reader tick, ms
POLLS="${POLLS:-16}"      # number of /health polls
POLL_INTERVAL="${POLL_INTERVAL:-1}"  # seconds between polls
export CAP TICK

# The in-container workload: assembled as a here-doc so it runs identically
# whether launched via docker or locally.
WORKLOAD='
set -u
# deps (docker image is minimal)
if ! command -v awk >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  apt-get -qq update >/dev/null 2>&1 || true
  apt-get -qq install -y gawk curl procps >/dev/null 2>&1 || true
fi

# FIX-2b: neutralize any inherited PORT so the server falls back to its default
# and the driver probes the same port ($PROBE_PORT). Without this an inherited
# PORT could make the server bind elsewhere while we probe 9099 -> false-RED.
unset PORT

# Launch: server stdout -> awk process-substitution -> slow reader.
# stderr kept OUT of the pipe (2>/tmp/repro-err.log) so heartbeat/flood-tick
# lines remain visible even when the stdout pipe is wedged.
node "$REPRO_DIR/server.mjs" 2>/tmp/repro-err.log \
  > >(awk "{print \"[nextjs] \" \$0; fflush()}" | node "$REPRO_DIR/reader.mjs") &
sleep 1

NODE_PID=$(ps -eo pid,args | grep "[s]erver.mjs" | awk "{print \$1}" | head -1)
echo "=== stdout-wedge ${LANE:-RED} repro ==="
echo "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) node_pid=$NODE_PID CAP=$CAP TICK=$TICK FIXED=${FIXED:-0} IS_FIXED=${IS_FIXED:-0} probe_port=$PROBE_PORT platform=$(uname -s)"
echo "topology: server(blocking fd1) | awk fflush | reader(cap=$CAP/tick=${TICK}ms)"
echo "probing GET /health (static, no logging on its path):"
echo ""

read_cpu () {
  # returns "state=X cpu_jiffies=Y rss_kb=Z" from /proc (Linux)
  if [ -r "/proc/$1/stat" ]; then
    awk "{printf \"state=%s cpu_jiffies=%d\", \$3, (\$14+\$15)}" "/proc/$1/stat"
    awk "/VmRSS/{printf \" rss_kb=%s\", \$2}" "/proc/$1/status" 2>/dev/null
  else
    printf "state=? cpu=?"
  fi
}

# Extract the advancing flood-tick counter (n=NNN) from a stderr heartbeat line.
tick_n () { printf "%s" "$1" | sed -n "s/.*flood tick n=\([0-9][0-9]*\).*/\1/p"; }

WEDGE_COUNT=0        # polls where /health timed out or returned non-200
OK_COUNT=0           # polls where /health returned 200
FIRST_TICK=-1        # heartbeat n at first poll
LAST_TICK=-1         # heartbeat n at last poll
MAX_TICK=-1          # highest heartbeat n observed
WEDGE_AFTER_LIVE=0   # 1 if a healthy(+advancing) window preceded a wedge
SAW_HEALTHY=0        # 1 if we ever saw a 200

for i in $(seq 1 '"$POLLS"'); do
  T=$(date -u +%H:%M:%S.%3N)
  OUT=$(curl -s -o /dev/null -w "%{http_code} time=%{time_total}s" --max-time 3 "http://127.0.0.1:$PROBE_PORT/health" 2>/dev/null) || OUT="WEDGE(curl_timeout)"
  CPUINFO=$(read_cpu "$NODE_PID")
  TICK_LINE=$(tail -1 /tmp/repro-err.log 2>/dev/null)
  echo "$T health=[$OUT] | $CPUINFO | last_stderr=[$TICK_LINE]"

  # --- accumulate machine-readable outcome ---
  N=$(tick_n "$TICK_LINE"); [ -z "$N" ] && N=-1
  if [ "$N" -ge 0 ]; then
    [ "$FIRST_TICK" -lt 0 ] && FIRST_TICK=$N
    LAST_TICK=$N
    [ "$N" -gt "$MAX_TICK" ] && MAX_TICK=$N
  fi
  case "$OUT" in
    2*|"200 "*|"200")
      OK_COUNT=$((OK_COUNT+1)); SAW_HEALTHY=1 ;;
    *)
      WEDGE_COUNT=$((WEDGE_COUNT+1))
      # a wedge that follows a healthy window (with the loop having advanced)
      [ "$SAW_HEALTHY" -eq 1 ] && [ "$MAX_TICK" -ge 0 ] && WEDGE_AFTER_LIVE=1 ;;
  esac
  sleep '"$POLL_INTERVAL"'
done

echo ""
echo "=== interpretation ==="
if [ "${IS_FIXED:-0}" = "1" ]; then
  echo "GREEN = with the MUST-1 flood sources removed (CVDIAG breadcrumb +"
  echo "uvicorn access line), the residual stdout volume stays UNDER the reader"
  echo "drain cap. /health stays fast-200 for the ENTIRE window, the flood-tick"
  echo "heartbeat keeps advancing, cpu_jiffies keeps advancing (loop live, not"
  echo "parked in write(2)), and there is NO wedge. Contrast: FIXED=0 (RED) wedges."
else
  echo "RED = health transitions from fast 200 to WEDGE/timeout while cpu_jiffies"
  echo "STOPS advancing (event loop parked in blocking write(2), not spinning) and"
  echo "the process stays resident. The frozen flood tick (last_stderr) confirms the"
  echo "loop itself stopped, not just HTTP."
fi

# --- machine-readable summary consumed by the outer assertion block ---
# Emitted on a single grep-able line so the (Docker-external) driver can assert
# on the OUTCOME rather than trusting exit 0.
echo ""
echo "ASSERT_SUMMARY is_fixed=${IS_FIXED:-0} ok=$OK_COUNT wedge=$WEDGE_COUNT first_tick=$FIRST_TICK last_tick=$LAST_TICK max_tick=$MAX_TICK wedge_after_live=$WEDGE_AFTER_LIVE saw_healthy=$SAW_HEALTHY"
'

if [ "$RUNNER" = "docker" ]; then
  echo "[run.sh] running ${LANE:-RED} repro in Docker ($IMAGE) — real Linux blocking-pipe semantics" >&2
  {
    docker run --rm \
      -e CAP="$CAP" -e TICK="$TICK" -e REPRO_DIR=/repro \
      -e FIXED="$FIXED" -e IS_FIXED="$IS_FIXED" -e PROBE_PORT="$PROBE_PORT" \
      -e FIXED_LINES_PER_TICK="${FIXED_LINES_PER_TICK:-1}" \
      -e LANE="$LANE" \
      -e FLOOD_START_DELAY_MS="${FLOOD_START_DELAY_MS:-5000}" \
      -v "$HERE":/repro:ro \
      "$IMAGE" bash -c "$WORKLOAD"
  } 2>&1 | tee "$TRANSCRIPT"
else
  echo "[run.sh] running ${LANE:-RED} repro on host ($(uname -s)) — see README: macOS uses async" >&2
  echo "[run.sh] pipe stdout and may NOT wedge; server.mjs setBlocking(true) still applies." >&2
  REPRO_DIR="$HERE" LANE="$LANE" IS_FIXED="$IS_FIXED" PROBE_PORT="$PROBE_PORT" \
    bash -c "$WORKLOAD" 2>&1 | tee "$TRANSCRIPT"
fi

echo ""
echo "[run.sh] transcript saved to $TRANSCRIPT"

# =============================================================================
# FIX-4: machine assertion on the OUTCOME (not just exit 0).
#
# We parse the ASSERT_SUMMARY line the workload emitted into the transcript and
# FAIL (distinct non-zero exit + clear message) on a wrong result. Exit codes:
#   0  = outcome matched the lane (RED wedged / GREEN stayed healthy)
#   3  = harness error: server never served (no tick advance, all-timeout from t0)
#   4  = RED did not wedge (expected a wedge, saw none)
#   5  = GREEN wedged (expected no wedge, saw one)
#   6  = harness error: no ASSERT_SUMMARY found (workload didn't complete)
# =============================================================================
SUMMARY_LINE="$(grep '^ASSERT_SUMMARY ' "$TRANSCRIPT" | tail -1 || true)"
if [ -z "$SUMMARY_LINE" ]; then
  echo "[run.sh] ASSERT FAIL: no ASSERT_SUMMARY in transcript — workload did not complete" >&2
  exit 6
fi

# Pull fields out of the summary line (k=v tokens).
_val () { printf '%s\n' "$SUMMARY_LINE" | tr ' ' '\n' | sed -n "s/^$1=//p"; }
A_IS_FIXED=$(_val is_fixed);         A_WEDGE=$(_val wedge)
A_FIRST=$(_val first_tick);          A_LAST=$(_val last_tick);      A_MAX=$(_val max_tick)
A_WEDGE_AFTER_LIVE=$(_val wedge_after_live); A_SAW_HEALTHY=$(_val saw_healthy)

echo "[run.sh] assertion inputs: $SUMMARY_LINE"

# A server that never served: no heartbeat tick EVER advanced (max_tick<0) and
# it never answered a single healthy probe. Distinct from a real wedge (which
# has a live window first). This guards against a crashed / never-started server
# masquerading as a "wedge" (all-timeouts from t0).
if [ "$A_MAX" -lt 0 ] && [ "$A_SAW_HEALTHY" -eq 0 ]; then
  echo "[run.sh] ASSERT FAIL: harness error: server never served (no flood-tick advance, no healthy probe from t0)" >&2
  exit 3
fi

if [ "$A_IS_FIXED" = "1" ]; then
  # GREEN lane: require 0 wedges, at least one healthy probe, and a heartbeat
  # that advanced across the window (loop stayed live throughout).
  if [ "$A_WEDGE" -ne 0 ]; then
    echo "[run.sh] ASSERT FAIL: GREEN wedged (wedge=$A_WEDGE, expected 0)" >&2
    exit 5
  fi
  if [ "$A_SAW_HEALTHY" -ne 1 ] || [ "$A_LAST" -le "$A_FIRST" ]; then
    echo "[run.sh] ASSERT FAIL: GREEN health/heartbeat did not advance (saw_healthy=$A_SAW_HEALTHY first_tick=$A_FIRST last_tick=$A_LAST)" >&2
    exit 5
  fi
  echo "[run.sh] ASSERT PASS (GREEN): 0 wedge, health stayed 200, heartbeat advanced $A_FIRST->$A_LAST"
else
  # RED lane: require >=1 wedge AND that the heartbeat advanced BEFORE the wedge
  # (max_tick>0 and a healthy window preceded the wedge) — proving the loop was
  # live then froze, not a server that never started.
  if [ "$A_WEDGE" -lt 1 ]; then
    echo "[run.sh] ASSERT FAIL: RED did not wedge (wedge=$A_WEDGE, expected >=1)" >&2
    exit 4
  fi
  if [ "$A_MAX" -lt 1 ] || [ "$A_WEDGE_AFTER_LIVE" -ne 1 ]; then
    echo "[run.sh] ASSERT FAIL: harness error: server never served (wedge without a prior live window: max_tick=$A_MAX wedge_after_live=$A_WEDGE_AFTER_LIVE)" >&2
    exit 3
  fi
  echo "[run.sh] ASSERT PASS (RED): $A_WEDGE wedge(s) after a live window (max_tick=$A_MAX, wedge_after_live=1)"
fi
