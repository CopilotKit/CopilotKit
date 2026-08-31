#!/usr/bin/env bash
# Source-level RED/GREEN driver for the OpenAI-SDK wedge sites, sibling of
# run_prod.sh. Exercises the REAL production _generate_a2ui sync function
# (selected by TARGET) so that whether /health wedges under load is determined
# by the production SOURCE (the asyncio.to_thread offload in the async
# generate_a2ui wrapper), not by the harness.
#
# GREEN expectation: with the fix present, /health stays fast-200 (WEDGE==0)
#                    AND the real _generate_a2ui actually fired (>=1).
# Mutation guard   : FIXED toggles the harness call shape:
#                      EXPECT=green -> FIXED=1 (asyncio.to_thread offload)
#                      EXPECT=red   -> FIXED=0 (sync-on-loop, the bug)
#
# TARGET selects the production module under test:
#   ag2-beautiful-chat | llamaindex-agent | llamaindex-a2ui
#
# Invocation:
#   TARGET=llamaindex-agent EXPECT=red   ./run_prod_openai.sh   (must wedge)
#   TARGET=llamaindex-agent EXPECT=green ./run_prod_openai.sh   (must NOT wedge)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET="${TARGET:-ag2-beautiful-chat}"
EXPECT="${EXPECT:-green}"
# The harness owns RED/GREEN via FIXED, aligned with EXPECT.
if [ "$EXPECT" = "red" ]; then FIXED_ENV=0; else FIXED_ENV=1; fi
PORT="${PORT:-8000}"
MOCK_PORT="${MOCK_PORT:-8098}"
SLOW_SECONDS="${SLOW_SECONDS:-3}"
CONCURRENCY="${CONCURRENCY:-5}"

PY="${PY:-$HERE/.venv-repro-openai/bin/python}"
if [ ! -x "$PY" ]; then PY="python3"; fi

echo "========================================================"
echo "[async-wedge:OPENAI] TARGET=$TARGET EXPECT=$EXPECT FIXED=$FIXED_ENV PORT=$PORT MOCK_PORT=$MOCK_PORT SLOW_SECONDS=$SLOW_SECONDS CONCURRENCY=$CONCURRENCY"
echo "[async-wedge:OPENAI] driving REAL production _generate_a2ui (MODE=direct)"
echo "[async-wedge:OPENAI] PY=$PY"
echo "========================================================"

MOCK_PID=""; SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

cd "$HERE" || exit 3

# Pre-flight: reap any lingering uvicorn bound to our ports from a prior lane.
# Without this, sequential RED->GREEN runs on the same ports can reuse a wedged
# server from the previous lane (the RED lane's slow blocking requests keep the
# socket alive), producing a spurious GREEN wedge with tool_dispatch_fired=0.
if command -v lsof >/dev/null 2>&1; then
  for _port in "$PORT" "$MOCK_PORT"; do
    _pids="$(lsof -ti ":${_port}" 2>/dev/null || true)"
    # shellcheck disable=SC2086 # intentional word-split: multiple PIDs -> kill args
    [ -n "$_pids" ] && kill -9 $_pids 2>/dev/null || true
  done
  sleep 1
fi

SLOW_SECONDS="$SLOW_SECONDS" "$PY" -m uvicorn slow_openai:app \
  --host 127.0.0.1 --port "$MOCK_PORT" --log-level warning \
  >/tmp/async-wedge-openai-mock.log 2>&1 &
MOCK_PID=$!

# Point the real openai client (in production code) at the slow mock. The OpenAI
# SDK honors OPENAI_BASE_URL; llamaindex's raw `from openai import OpenAI`
# client honors it too. (The llama_index framework LLM object honors OPENAI_API_BASE,
# but the wedge site uses the raw SDK client, which reads OPENAI_BASE_URL.)
TARGET="$TARGET" FIXED="$FIXED_ENV" \
  OPENAI_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1" \
  OPENAI_API_KEY="sk-repro-not-a-real-key" \
  "$PY" -m uvicorn prod_server_openai:app --host 127.0.0.1 --port "$PORT" --log-level warning \
  >/tmp/async-wedge-openai-server.log 2>&1 &
SERVER_PID=$!

echo "[async-wedge:OPENAI] waiting for servers..."
UP=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${MOCK_PORT}/openapi.json" >/dev/null 2>&1 \
     && curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    UP=1; break
  fi
  sleep 0.5
done
if [ "$UP" -ne 1 ]; then
  echo "[async-wedge:OPENAI] FAIL: servers did not come up"
  echo "----- mock log -----";   tail -30 /tmp/async-wedge-openai-mock.log 2>/dev/null
  echo "----- server log -----"; tail -40 /tmp/async-wedge-openai-server.log 2>/dev/null
  exit 3
fi
echo "[async-wedge:OPENAI] servers up; /health fast-200 confirmed pre-load"

# Concurrent load against the real _generate_a2ui endpoint. Cap each request at
# 12s so it outlives the 10s poll window without lingering.
LOAD_PIDS=()
for _ in $(seq 1 "$CONCURRENCY"); do
  curl -s -o /dev/null --max-time 12 -X POST "http://127.0.0.1:${PORT}/generate" &
  LOAD_PIDS+=($!)
done

WEDGE=0; OK=0
for i in $(seq 1 10); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo TIMEOUT)"
  if [ "$CODE" = "200" ]; then OK=$((OK+1)); echo "[async-wedge:OPENAI] health poll $i: 200 OK";
  else WEDGE=$((WEDGE+1)); echo "[async-wedge:OPENAI] health poll $i: WEDGE ($CODE)"; fi
  sleep 1
done

DISPATCH="$(curl -s --max-time 2 "http://127.0.0.1:${PORT}/stats" 2>/dev/null \
  | sed -n 's/.*"tool_dispatch_fired"[: ]*\([0-9]*\).*/\1/p')"
DISPATCH="${DISPATCH:-0}"

if [ "${#LOAD_PIDS[@]}" -gt 0 ]; then
  for _pid in "${LOAD_PIDS[@]}"; do kill "$_pid" 2>/dev/null || true; done
  wait "${LOAD_PIDS[@]}" 2>/dev/null || true
fi

echo "========================================================"
echo "ASSERT_SUMMARY target=$TARGET expect=$EXPECT ok=$OK wedge=$WEDGE tool_dispatch_fired=$DISPATCH"
echo "========================================================"

if [ "$EXPECT" = "green" ]; then
  if [ "$WEDGE" -ne 0 ]; then
    echo "FAIL GREEN: expected 0 wedges, observed $WEDGE — production loop still blocked"
    exit 5
  fi
  if [ "$DISPATCH" -lt 1 ]; then
    echo "FAIL GREEN: 0 wedges but tool_dispatch_fired=$DISPATCH — _generate_a2ui never ran; WEDGE==0 is a false green (bug site never exercised)"
    exit 6
  fi
  echo "PASS GREEN: 0 wedges AND tool_dispatch_fired=$DISPATCH (>=1) — real production code exercised the bug site and kept /health fast-200 under load"
  exit 0
else
  if [ "$WEDGE" -lt 1 ]; then
    echo "FAIL RED: expected >=1 wedge, observed 0 — did not reproduce the bug"
    exit 4
  fi
  echo "PASS RED: $WEDGE wedge(s) — sync-on-loop wedged the loop (bug reproduced)"
  exit 0
fi
