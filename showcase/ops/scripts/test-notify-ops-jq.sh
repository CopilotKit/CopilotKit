#!/usr/bin/env bash
# Guards the notify-ops per-job partition jq expression against
# service/starter-name collisions.
#
# The showcase_deploy.yml `notify-ops` step maps each service name in
# $SERVICES to the matrix build job that ran for it, then partitions into
# FAILED / SUCCEEDED. Matrix job names render as
# "build (<dispatch_name>, <context>, <image>, ...)". The previous
# `contains($svc)` matcher produced false positives: `agno` matched both
# `build (agno, ...)` AND `build (starter-agno, ...)`. The fixed matcher
# uses a token-bounded prefix `startswith("build (" + $svc + ",")`.
#
# This script replays the bug scenario: a matrix that built BOTH `agno`
# (failed) and `starter-agno` (succeeded). Old matcher would mis-attribute
# `starter-agno`'s success to `agno` and/or count `agno`'s failure against
# `starter-agno`. New matcher must:
#   - FAILED[agno]         true    SUCCEEDED[agno]         false
#   - FAILED[starter-agno] false   SUCCEEDED[starter-agno] true
#
# Usage: bash showcase/ops/scripts/test-notify-ops-jq.sh
# Exits non-zero on regression.

set -euo pipefail

# Fixture matching the real GitHub Actions jobs API shape: a single build
# job per matrix leg, named `build (<all object fields, comma-separated>)`.
BUILD_JOBS='[
  {"name":"build (agno, showcase/packages/agno, showcase-agno, 32cab80b, 15, false, , , /api/health)","conclusion":"failure"},
  {"name":"build (starter-agno, showcase/starters/agno, showcase-starter-agno, baf9f0db, 15, false, , , /api/health)","conclusion":"success"},
  {"name":"build (ag2, showcase/packages/ag2, showcase-ag2, 4a37481b, 15, false, , , /api/health)","conclusion":"success"},
  {"name":"build (starter-ag2, showcase/starters/ag2, showcase-starter-ag2, 0d7ce4ea, 15, false, , , /api/health)","conclusion":"failure"},
  {"name":"build (mastra, showcase/packages/mastra, showcase-mastra, d7979eb7, 15, false, , , /api/health)","conclusion":"success"},
  {"name":"build (starter-mastra, showcase/starters/mastra, showcase-starter-mastra, 315270a7, 15, false, , , /api/health)","conclusion":"success"}
]'

SERVICES='["agno","starter-agno","ag2","starter-ag2","mastra","starter-mastra"]'

# Fixed matcher — mirrors the jq inside showcase_deploy.yml.
FAILED=$(echo "$SERVICES" | jq -c --argjson jobs "$BUILD_JOBS" '
  [
    .[] as $svc
    | $jobs[]
    | select((.name // "") as $n | ($n | startswith("build (" + $svc + ",")) or $n == ("build (" + $svc + ")"))
    | select(.conclusion == "failure")
    | $svc
  ] | unique
')

SUCCEEDED=$(echo "$SERVICES" | jq -c --argjson jobs "$BUILD_JOBS" '
  [
    .[] as $svc
    | $jobs[]
    | select((.name // "") as $n | ($n | startswith("build (" + $svc + ",")) or $n == ("build (" + $svc + ")"))
    | select(.conclusion == "success")
    | $svc
  ] | unique
')

EXPECTED_FAILED='["agno","starter-ag2"]'
EXPECTED_SUCCEEDED='["ag2","mastra","starter-agno","starter-mastra"]'

fail=0
if [ "$FAILED" != "$EXPECTED_FAILED" ]; then
  echo "FAIL: FAILED mismatch"
  echo "  expected: $EXPECTED_FAILED"
  echo "  got:      $FAILED"
  fail=1
fi
if [ "$SUCCEEDED" != "$EXPECTED_SUCCEEDED" ]; then
  echo "FAIL: SUCCEEDED mismatch"
  echo "  expected: $EXPECTED_SUCCEEDED"
  echo "  got:      $SUCCEEDED"
  fail=1
fi

if [ $fail -ne 0 ]; then
  exit 1
fi

# Sanity: prove the OLD `contains()` matcher would have regressed this case
# — we want the NEW matcher to differ from the old one on the collision
# fixture, otherwise this test is vacuous.
OLD_FAILED=$(echo "$SERVICES" | jq -c --argjson jobs "$BUILD_JOBS" '
  [
    .[] as $svc
    | $jobs[]
    | select((.name // "") | contains($svc))
    | select(.conclusion == "failure")
    | $svc
  ] | unique
')
if [ "$OLD_FAILED" = "$FAILED" ]; then
  echo "FAIL: test is vacuous — old matcher produced the same FAILED as new one"
  echo "  both: $OLD_FAILED"
  exit 1
fi

echo "PASS: notify-ops jq partition is collision-free"
echo "  FAILED:    $FAILED"
echo "  SUCCEEDED: $SUCCEEDED"
echo "  (old contains() would have: FAILED=$OLD_FAILED)"
