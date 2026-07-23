#!/usr/bin/env bash
# reconcile-prod-gate.sh — on-demand drift gate: assert NO prod service has
# drifted STALE vs a green staging.
#
# Mirrors lint-prod-gate.sh (a thin wrapper around a `bin/railway` subcommand
# whose exit-code contract IS the gate), but checks a DIFFERENT invariant:
#
#   * lint-prod-gate asserts every prod service is PINNED to an immutable
#     `@sha256:` digest (no born-on-:latest float).
#   * reconcile-prod-gate asserts no prod service is STALE — i.e. its serving
#     digest has not drifted BEHIND a green staging. The showcase deploy model
#     is staging=mutable `:latest` (continuously rebuilt), prod=immutable
#     `@sha256:` (advances only on explicit promote), so prod can silently fall
#     behind a green staging — a dead/stale prod column that today is only
#     noticed by eyeballing it. This gate detects that drift on demand so a
#     manual workflow run can surface it.
#
# It is a thin wrapper around `bin/railway reconcile-prod`, whose exit-code
# contract IS the gate: exit 0 = no service stale (all green, or only
# green+gray), exit 1 = at least one stale (prod drifted behind green staging),
# exit 2 = hard error (auth/GraphQL). Any non-zero fails the step (and the run).
# We do NOT pass any advisory flag — a stale prod column must red the run.
#
# Output is surfaced into $GITHUB_STEP_SUMMARY (the readable per-service table)
# AND to stdout (the job log). When RECONCILE_JSON is set the machine output is
# also captured to that file (uploaded as a workflow artifact for inspection).
#
# Usage:
#   RAILWAY_TOKEN=... scripts/reconcile-prod-gate.sh
#
# Env:
#   RAILWAY_TOKEN  (required by bin/railway reconcile-prod to read the prod
#                  snapshot + staging deployments; this wrapper does not consult
#                  it directly — bin/railway does).
#   RAILWAY_BIN    (optional) path to the railway CLI (default: sibling
#                  ../bin/railway). Overridable for testing.
#   RECONCILE_JSON (optional) path to write the machine-readable JSON output to
#                  (in addition to the human table). When set, the gate also
#                  invokes `reconcile-prod --json` and writes the result there
#                  (uploaded as a workflow artifact for inspection).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(dirname "$HERE")"
RAILWAY_BIN="${RAILWAY_BIN:-$SHOWCASE_DIR/bin/railway}"

# Validate the railway CLI up front. Without this, a missing/non-executable
# binary makes the reconcile-prod invocation fail with 126/127 — fail loud with
# a clear message instead of a cryptic exec error. `-x` covers an absolute
# path; `command -v` covers RAILWAY_BIN being a bare PATH command name.
if [ ! -x "$RAILWAY_BIN" ] && ! command -v "$RAILWAY_BIN" >/dev/null 2>&1; then
  echo "::error::reconcile-prod-gate: RAILWAY_BIN '$RAILWAY_BIN' is missing or not executable; cannot run the drift gate." >&2
  exit 1
fi

# Optionally capture machine-readable JSON (uploaded as a workflow artifact).
# This is a best-effort SECOND invocation (read-only) — its rc does not decide
# the gate (the human-table invocation below does); a JSON-write failure must
# not change the gate verdict.
#
# We capture stdout to a temp first (NOT straight to $RECONCILE_JSON) so that:
#   * the probe's stderr is PRESERVED to the job log (a failed --json capture —
#     e.g. a staging GraphQL outage — must leave a diagnostic trail, never be
#     routed to /dev/null and vanish); and
#   * we only publish a NON-BLANK payload. On a hard error reconcile-prod emits
#     no stdout, and writing the empty result straight to $RECONCILE_JSON would
#     upload a blank artifact that looks like a real (empty) reconciliation.
#     Guard the write so a blank/empty payload is skipped.
if [ -n "${RECONCILE_JSON:-}" ]; then
  echo "==> $RAILWAY_BIN reconcile-prod --json (machine output -> $RECONCILE_JSON)"
  json_tmp="$(mktemp)"
  # stdout -> temp; stderr -> the job log (preserve the diagnostic). rc is
  # ignored (best-effort); the human-table invocation below decides the gate.
  "$RAILWAY_BIN" reconcile-prod --json > "$json_tmp" || true
  if [ -s "$json_tmp" ]; then
    cp "$json_tmp" "$RECONCILE_JSON"
  else
    echo "reconcile-prod-gate: --json capture produced no payload; skipping blank artifact write to $RECONCILE_JSON." >&2
  fi
  rm -f "$json_tmp"
fi

echo "==> $RAILWAY_BIN reconcile-prod"
# Run the gate and capture its readable output so we can mirror it to the GH
# step summary AND surface it on stdout. reconcile-prod exits 1 on a stale
# service and 2 on a hard error; either is a step failure. We capture rc
# explicitly (set -e is intentionally off) so the failure message below is
# precise about the verdict.
OUT="$("$RAILWAY_BIN" reconcile-prod 2>&1)"
rc=$?

# Mirror the table to the job log.
printf '%s\n' "$OUT"

# Surface the table into the GH step summary (when running under Actions).
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Prod ⇆ staging reconciliation"
    echo ""
    echo '```'
    printf '%s\n' "$OUT"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$rc" -eq 0 ]; then
  echo "OK: no production service has drifted stale vs staging."
  exit 0
fi

echo "::error::reconcile-prod-gate: at least one production service is STALE vs a green staging (bin/railway reconcile-prod exit $rc). Prod has fallen behind staging — promote it via 'bin/railway promote <svc>' (or investigate if staging is the wrong reference)." >&2
exit "$rc"
