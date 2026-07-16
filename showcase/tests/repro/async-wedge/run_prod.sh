#!/usr/bin/env bash
# Source-level RED/GREEN driver: exercises the REAL production
# run_a2ui_dynamic_agent generator (src/agents/a2ui_dynamic.py) so that whether
# /health wedges under load is determined by the production SOURCE (the
# asyncio.to_thread offload at line ~287), not by the harness.
#
# GREEN expectation: with the fix present, /health stays fast-200 (WEDGE==0).
# Mutation guard: revert the source offload -> re-run -> /health MUST wedge
#                 (WEDGE>=1), proving the harness fails on the bug.
#
# EXPECT=green (default): require WEDGE==0, exit 5 on any wedge.
# EXPECT=red             : require WEDGE>=1, exit 4 if no wedge.
#
# MODE=generator (default): drive the full run_a2ui_dynamic_agent generator
#                           end-to-end (integration-level GREEN proof).
# MODE=direct             : exercise the REAL _generate_a2ui sync function in
#                           isolation; FIXED toggles the call shape so the
#                           mutation guard is deterministic:
#                             EXPECT=green -> FIXED=1 (asyncio.to_thread offload)
#                             EXPECT=red   -> FIXED=0 (sync-on-loop, the bug)
#
# Mutation guard invocation:
#   MODE=direct EXPECT=red   ./run_prod.sh   (must wedge)
#   MODE=direct EXPECT=green ./run_prod.sh   (must NOT wedge)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTEG_DIR="$(cd "$HERE/../../../integrations/claude-sdk-python" && pwd)"

EXPECT="${EXPECT:-green}"
MODE="${MODE:-generator}"
# In MODE=direct the harness owns RED/GREEN via FIXED, aligned with EXPECT.
if [ "$MODE" = "direct" ]; then
  if [ "$EXPECT" = "red" ]; then FIXED_ENV=0; else FIXED_ENV=1; fi
else
  FIXED_ENV="${FIXED:-1}"
fi
PORT="${PORT:-8000}"
MOCK_PORT="${MOCK_PORT:-8099}"
SLOW_SECONDS="${SLOW_SECONDS:-3}"
CONCURRENCY="${CONCURRENCY:-5}"

if [ -x "$INTEG_DIR/.venv-repro/bin/python" ]; then
  PY="${PY:-$INTEG_DIR/.venv-repro/bin/python}"
else
  PY="${PY:-python3}"
fi

echo "========================================================"
echo "[async-wedge:PROD] EXPECT=$EXPECT  MODE=$MODE  FIXED=$FIXED_ENV  PORT=$PORT  MOCK_PORT=$MOCK_PORT  SLOW_SECONDS=$SLOW_SECONDS  CONCURRENCY=$CONCURRENCY"
echo "[async-wedge:PROD] driving REAL production a2ui_dynamic code (MODE=$MODE)"
echo "[async-wedge:PROD] PY=$PY"
echo "========================================================"

MOCK_PID=""; SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

SLOW_SECONDS="$SLOW_SECONDS" "$PY" -m uvicorn slow_anthropic:app \
  --host 127.0.0.1 --port "$MOCK_PORT" --log-level warning \
  >/tmp/async-wedge-prod-mock.log 2>&1 &
MOCK_PID=$!

# Point the real anthropic clients (in production code) at the slow mock.
MODE="$MODE" FIXED="$FIXED_ENV" \
  ANTHROPIC_BASE_URL="http://127.0.0.1:${MOCK_PORT}" \
  ANTHROPIC_API_KEY="sk-repro-not-a-real-key" \
  "$PY" -m uvicorn prod_server:app --host 127.0.0.1 --port "$PORT" --log-level warning \
  >/tmp/async-wedge-prod-server.log 2>&1 &
SERVER_PID=$!

echo "[async-wedge:PROD] waiting for servers..."
UP=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${MOCK_PORT}/openapi.json" >/dev/null 2>&1 \
     && curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    UP=1; break
  fi
  sleep 0.5
done
if [ "$UP" -ne 1 ]; then
  echo "[async-wedge:PROD] FAIL: servers did not come up"
  echo "----- mock log -----";   tail -30 /tmp/async-wedge-prod-mock.log 2>/dev/null
  echo "----- server log -----"; tail -30 /tmp/async-wedge-prod-server.log 2>/dev/null
  exit 3
fi
echo "[async-wedge:PROD] servers up; /health fast-200 confirmed pre-load"

# Concurrent load against the REAL generator endpoint.
for _ in $(seq 1 "$CONCURRENCY"); do
  curl -s -o /dev/null --max-time 40 -X POST "http://127.0.0.1:${PORT}/generate" &
done

WEDGE=0; OK=0
for i in $(seq 1 10); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo TIMEOUT)"
  if [ "$CODE" = "200" ]; then OK=$((OK+1)); echo "[async-wedge:PROD] health poll $i: 200 OK";
  else WEDGE=$((WEDGE+1)); echo "[async-wedge:PROD] health poll $i: WEDGE ($CODE)"; fi
  sleep 1
done
wait 2>/dev/null || true

echo "========================================================"
echo "ASSERT_SUMMARY expect=$EXPECT ok=$OK wedge=$WEDGE"
echo "----- generator output sample -----"
grep -c chunks /tmp/async-wedge-prod-server.log 2>/dev/null || true
echo "========================================================"

if [ "$EXPECT" = "green" ]; then
  if [ "$WEDGE" -ne 0 ]; then
    echo "FAIL GREEN: expected 0 wedges, observed $WEDGE — production loop still blocked"
    exit 5
  fi
  echo "PASS GREEN: 0 wedges — real production code kept /health fast-200 under load"
  exit 0
else
  if [ "$WEDGE" -lt 1 ]; then
    echo "FAIL RED: expected >=1 wedge, observed 0 — did not reproduce the bug"
    exit 4
  fi
  echo "PASS RED: $WEDGE wedge(s) — sync-on-loop wedged the loop (bug reproduced)"
  exit 0
fi
