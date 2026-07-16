#!/usr/bin/env bash
# RED/GREEN repro driver for the claude-sdk-python :8000 async event-loop wedge.
#
# Faithful topology:
#   slow_anthropic.py  (separate process, own loop)  <- real HTTP, SLOW_SECONDS latency
#         ^ base_url
#   server.py          (single uvicorn event loop)   <- real anthropic.Anthropic sync client
#     FIXED=0 RED:   sync client.messages.create() ON the loop -> loop parks -> /health wedges
#     FIXED=1 GREEN: await asyncio.to_thread(...)          -> loop stays live -> /health fast-200
#
# While 5x concurrent POST /generate saturate the loop, we poll GET /health
# once/sec for 10s and count how many polls fail/timeout (WEDGE) vs 200 (OK).
#
# Asserts and exits non-zero on a false result, so a false-GREEN cannot pass:
#   RED   (FIXED=0): require WEDGE >= 1   (exit 4 if it did NOT wedge)
#   GREEN (FIXED=1): require WEDGE == 0   (exit 5 if any wedge observed)
#
# Usage:
#   FIXED=0 ./run.sh    # RED lane  — expect wedge
#   FIXED=1 ./run.sh    # GREEN lane — expect no wedge
#
# Env:
#   PY           python interpreter with anthropic+fastapi+uvicorn installed
#                (default: ./.venv-repro python resolved relative to the
#                 claude-sdk-python integration)
#   SLOW_SECONDS latency of the mock LLM endpoint (default 3)
#   PORT         SUT port (default 8000); mock endpoint is PORT+99-ish (8099)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEG_DIR="$(cd "$HERE/../../../integrations/claude-sdk-python" && pwd)"

# CANONICAL FIXED PREDICATE — byte-identical with server.py.
FIXED="${FIXED:-0}"
FIXED_LC="$(printf '%s' "$FIXED" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [ "$FIXED_LC" = "1" ] || [ "$FIXED_LC" = "true" ]; then
  IS_FIXED=1
  LANE="GREEN (asyncio.to_thread offload)"
else
  IS_FIXED=0
  LANE="RED (sync client on event loop)"
fi

PORT="${PORT:-8000}"
MOCK_PORT="${MOCK_PORT:-8099}"
SLOW_SECONDS="${SLOW_SECONDS:-3}"
CONCURRENCY="${CONCURRENCY:-5}"

# Resolve a python that has the deps. Prefer the repro venv created next to the
# integration; fall back to $PY, then `python3`.
if [ -x "$INTEG_DIR/.venv-repro/bin/python" ]; then
  PY="${PY:-$INTEG_DIR/.venv-repro/bin/python}"
else
  PY="${PY:-python3}"
fi

echo "========================================================"
echo "[async-wedge] LANE: $LANE"
echo "[async-wedge] FIXED=$FIXED (IS_FIXED=$IS_FIXED)  PORT=$PORT  MOCK_PORT=$MOCK_PORT  SLOW_SECONDS=$SLOW_SECONDS  CONCURRENCY=$CONCURRENCY"
echo "[async-wedge] PY=$PY"
echo "========================================================"

MOCK_PID=""
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 1) Start the slow Anthropic-compatible mock endpoint (own process/loop).
SLOW_SECONDS="$SLOW_SECONDS" "$PY" -m uvicorn slow_anthropic:app \
  --host 127.0.0.1 --port "$MOCK_PORT" --log-level warning \
  >/tmp/async-wedge-mock.log 2>&1 &
MOCK_PID=$!

# 2) Start the system-under-test (single event loop, matching prod uvicorn).
FIXED="$FIXED" SLOW_BASE_URL="http://127.0.0.1:${MOCK_PORT}" \
  "$PY" -m uvicorn server:app --host 127.0.0.1 --port "$PORT" --log-level warning \
  >/tmp/async-wedge-server.log 2>&1 &
SERVER_PID=$!

# Wait for both to accept connections (health must be fast-200 BEFORE load).
echo "[async-wedge] waiting for servers to come up..."
UP=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${MOCK_PORT}/openapi.json" >/dev/null 2>&1 \
     && curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    UP=1; break
  fi
  sleep 0.5
done
if [ "$UP" -ne 1 ]; then
  echo "[async-wedge] FAIL: servers did not come up"
  echo "----- mock log -----";   tail -20 /tmp/async-wedge-mock.log 2>/dev/null
  echo "----- server log -----"; tail -20 /tmp/async-wedge-server.log 2>/dev/null
  exit 3
fi
echo "[async-wedge] both servers up; /health fast-200 confirmed pre-load"

# 3) Fire concurrent load in the background.
PORT="$PORT" CONCURRENCY="$CONCURRENCY" bash "$HERE/load.sh" &
LOAD_PID=$!

# Brief gap so at least one /generate reaches the SUT and begins blocking its
# loop before the first /health poll fires; otherwise poll 1 can be a legitimate
# fast-200 even in the RED case (wasted poll).
sleep 0.5

# 4) Poll /health once/sec for 10s while load is in flight.
WEDGE=0; OK=0
for i in $(seq 1 10); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo TIMEOUT)"
  if [ "$CODE" = "200" ]; then
    OK=$((OK+1))
    echo "[async-wedge] health poll $i: 200 OK"
  else
    WEDGE=$((WEDGE+1))
    echo "[async-wedge] health poll $i: WEDGE ($CODE)"
  fi
  sleep 1
done

wait "$LOAD_PID" 2>/dev/null || true

echo "========================================================"
echo "ASSERT_SUMMARY is_fixed=$IS_FIXED ok=$OK wedge=$WEDGE"
echo "========================================================"

if [ "$IS_FIXED" = "1" ]; then
  if [ "$WEDGE" -ne 0 ]; then
    echo "FAIL GREEN: expected 0 wedges, observed $WEDGE — event loop still blocked"
    exit 5
  fi
  echo "PASS GREEN: 0 wedges — /health stayed fast-200 under identical load"
  exit 0
else
  if [ "$WEDGE" -lt 1 ]; then
    echo "FAIL RED: expected >=1 wedge, observed 0 — harness did not reproduce the bug"
    exit 4
  fi
  echo "PASS RED: $WEDGE wedge(s) — /health went unresponsive while the sync call blocked the loop"
  exit 0
fi
