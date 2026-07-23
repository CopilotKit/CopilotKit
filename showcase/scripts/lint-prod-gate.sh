#!/usr/bin/env bash
# lint-prod-gate.sh — post-promote gate: assert EVERY prod service is pinned to
# an immutable `@sha256:` digest.
#
# Extracted from .github/workflows/showcase_promote.yml (UNIT U12, spec §8.2) so
# the gate is unit-testable (see __tests__/lint-prod-gate.bats), mirroring how
# promote-fleet.sh / verify-prod-display.sh / resolve-promote-targets.sh were
# pulled out of this same workflow.
#
# Why a SEPARATE gate (it complements, not duplicates, the equivalence gate):
#   * verify-prod's per-service probe (verify-deploy.ts) asserts the prod service
#     is HEALTHY.
#   * U10's equivalence re-sweep asserts prod is FUNCTIONALLY EQUIVALENT to
#     staging.
#   * Neither asserts PINNED-NESS. A born-on-`:latest` prod service
#     (deploy-to-railway.ts provisions an unpinned source.image, spec R-E) can be
#     healthy AND functionally equivalent while still floating on a mutable tag —
#     a latent rollback/repro hazard. This gate asserts every prod service is on
#     an immutable digest, catching such a service LOUD post-promote.
#
# It is a thin wrapper around `bin/railway lint-prod`, whose exit-code contract
# IS the gate: exit 0 = all prod services digest-pinned, exit 1 = at least one
# unpinned (findings), exit 2 = hard error (auth/GraphQL). Any non-zero fails the
# step (and the run) — we deliberately do NOT pass --exit-zero (advisory mode):
# an unpinned prod service must red the run, not just print a warning.
#
# Usage:
#   RAILWAY_TOKEN=... scripts/lint-prod-gate.sh
#
# Env:
#   RAILWAY_TOKEN  (required by bin/railway lint-prod to read the prod snapshot;
#                  this wrapper does not consult it directly — bin/railway does).
#   RAILWAY_BIN    (optional) path to the railway CLI (default: sibling
#                  ../bin/railway). Overridable for testing.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(dirname "$HERE")"
RAILWAY_BIN="${RAILWAY_BIN:-$SHOWCASE_DIR/bin/railway}"

# Validate the railway CLI up front. Without this, a missing/non-executable
# binary makes the lint-prod invocation fail with 126/127 — fail loud with a
# clear message instead of a cryptic exec error. `-x` covers an absolute path;
# `command -v` covers RAILWAY_BIN being a bare PATH command name.
if [ ! -x "$RAILWAY_BIN" ] && ! command -v "$RAILWAY_BIN" >/dev/null 2>&1; then
  echo "::error::lint-prod-gate: RAILWAY_BIN '$RAILWAY_BIN' is missing or not executable; cannot run the pinned-ness gate." >&2
  exit 1
fi

echo "==> $RAILWAY_BIN lint-prod"
# Run the gate. lint-prod exits 1 on findings (an unpinned prod service) and 2 on
# a hard error; either is a step failure. We capture the rc explicitly (rather
# than relying on `set -e`, which is intentionally off) so the failure message
# below is precise about which service(s) tripped — lint-prod already prints the
# per-service findings to stdout, which CI surfaces.
"$RAILWAY_BIN" lint-prod
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "OK: every production service is digest-pinned (@sha256:)."
  exit 0
fi

echo "::error::lint-prod-gate: production is NOT fully digest-pinned (bin/railway lint-prod exit $rc). A born-on-:latest prod service (spec R-E) floats on a mutable tag — re-pin it via 'bin/railway promote <svc>' or 'bin/railway pin <svc> <digest>'." >&2
exit "$rc"
