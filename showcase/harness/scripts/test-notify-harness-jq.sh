#!/usr/bin/env bash
# Guards the notify-harness per-job partition jq expression against
# service-name collisions.
#
# The showcase_deploy.yml `notify-harness` step maps each service name in
# $SERVICES to the matrix build job that ran for it, then partitions into
# FAILED / SUCCEEDED. Matrix job names render as
# "build (<dispatch_name>, <context>, <image>, ...)". The previous
# `contains($svc)` matcher produced false positives when one service name
# was a substring of another. The fixed matcher uses a token-bounded
# prefix `startswith("build (" + $svc + ",")`.
#
# This script replays a scenario where `agno` (failed) and `ag2`
# (succeeded) coexist — verifying that the partition matcher attributes
# each correctly without substring confusion.
#
# Usage: bash showcase/harness/scripts/test-notify-harness-jq.sh
# Exits non-zero on regression.

set -euo pipefail

# Fixture matching the real GitHub Actions jobs API shape: a single build
# job per matrix leg, named `build (<all object fields, comma-separated>)`.
BUILD_JOBS='[
  {"name":"build (agno, showcase/integrations/agno, showcase-agno, 32cab80b, 15, false, , , /api/health)","conclusion":"failure"},
  {"name":"build (ag2, showcase/integrations/ag2, showcase-ag2, 4a37481b, 15, false, , , /api/health)","conclusion":"success"},
  {"name":"build (mastra, showcase/integrations/mastra, showcase-mastra, d7979eb7, 15, false, , , /api/health)","conclusion":"success"}
]'

SERVICES='["agno","ag2","mastra"]'

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

EXPECTED_FAILED='["agno"]'
EXPECTED_SUCCEEDED='["ag2","mastra"]'

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

echo "PASS: notify-harness jq partition is collision-free"
echo "  FAILED:    $FAILED"
echo "  SUCCEEDED: $SUCCEEDED"
