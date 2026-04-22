#!/usr/bin/env bash
# Coordinated Docker rebuild for parallel review agents.
#
# Problem: many parallel agents each need a fresh build of
# showcase-langgraph-python to screenshot the live page. Running
# `dev-local.sh up langgraph-python` N times serializes on Docker and
# wastes time rebuilding the same source.
#
# Strategy: align rebuild attempts to a clock tick (30-second boundary)
# with a small jitter. First agent on a tick acquires a lock, does the
# rebuild, and writes a per-tick done marker. Other agents in the same
# tick see the lock held, wait for the done marker, and skip their own
# build. If the marker doesn't appear within 30s, they try the next tick.
#
# Usage:
#   bash /Users/ataibarkai/LocalGit/CopilotKit/showcase/scripts/agent-notes/rebuild-coord.sh
#
# Exit codes:
#   0 — rebuild completed (by this agent or by a peer on the same tick)
#   1 — exhausted retry budget

set -euo pipefail

LOCK_DIR=/tmp/showcase-rebuild.lock
DONE_PREFIX=/tmp/showcase-rebuild.done-
REPO_ROOT=/Users/ataibarkai/LocalGit/CopilotKit
MAX_TICKS=3

tick_of() { echo $(( $1 / 30 )); }

cleanup_stale_markers() {
  # Keep only markers from the last ~10 minutes so /tmp doesn't fill.
  find /tmp -maxdepth 1 -name 'showcase-rebuild.done-*' -mmin +10 -delete 2>/dev/null || true
}

cleanup_stale_markers

for attempt in $(seq 1 $MAX_TICKS); do
  now=$(date +%s)
  sec_in_min=$(( now % 30 ))
  wait_to_boundary=$(( sec_in_min == 0 ? 0 : 30 - sec_in_min ))
  jitter=$(( RANDOM % 6 ))          # 0..5 s
  sleep $(( wait_to_boundary + jitter ))

  now=$(date +%s)
  tick=$(tick_of $now)
  done_marker=${DONE_PREFIX}${tick}

  if mkdir "$LOCK_DIR" 2>/dev/null; then
    # Acquired lock — run the build.
    trap 'rm -rf "$LOCK_DIR"' EXIT
    echo "[rebuild-coord][$$] tick=$tick acquired lock, rebuilding..."
    (
      cd "$REPO_ROOT"
      ./showcase/scripts/dev-local.sh up langgraph-python
    ) >/tmp/showcase-rebuild.${tick}.log 2>&1
    rc=$?
    touch "$done_marker"
    rm -rf "$LOCK_DIR"
    trap - EXIT
    if [ $rc -ne 0 ]; then
      echo "[rebuild-coord][$$] rebuild FAILED (rc=$rc); see /tmp/showcase-rebuild.${tick}.log"
      exit $rc
    fi
    echo "[rebuild-coord][$$] tick=$tick rebuild complete"
    exit 0
  fi

  # Lock held by another agent on this (or an earlier) tick — wait for marker.
  echo "[rebuild-coord][$$] tick=$tick lock held, waiting for done marker..."
  deadline=$(( now + 30 ))
  while [ $(date +%s) -lt $deadline ]; do
    if [ -f "$done_marker" ]; then
      echo "[rebuild-coord][$$] tick=$tick rebuild finished by peer"
      exit 0
    fi
    sleep 1
  done
  echo "[rebuild-coord][$$] tick=$tick timed out; retrying next tick"
done

echo "[rebuild-coord][$$] exhausted $MAX_TICKS ticks without confirmation"
exit 1
