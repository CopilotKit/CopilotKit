#!/usr/bin/env bash
# verify-prod-display.sh — compute the verify-prod value shown in the promote
# Slack alert (`verify-prod=<value>`).
#
# Extracted from .github/workflows/showcase_promote.yml so the derivation is
# unit-testable (see __tests__/verify-prod-display.bats), mirroring how
# promote-fleet.sh was extracted from the same workflow.
#
# The bug this fixes (follow-up to run 27144525566): verify-prod's empty-CSV
# skip branch exits 0, so the GitHub job `result` is `success` even though prod
# was NEVER probed. The notify step used to render that raw `result` and emit a
# misleading `verify-prod=success`. We instead read the verify-prod job's own
# `status` OUTPUT (which it sets to `success` after a real probe, or `skipped`
# when nothing promoted) and only fall back to the job result for failure /
# cancelled (where the output was never written).
#
# Usage:
#   PROD=<job-result> PROD_STATUS=<job-output> scripts/verify-prod-display.sh
#
# Env:
#   PROD         (required)  the verify-prod GitHub job `result`
#                            (success|failure|cancelled|skipped).
#   PROD_STATUS  (optional)  the verify-prod job's `status` output
#                            (success|skipped); empty when the job
#                            failed/cancelled or never wrote it.
#
# Prints the display value to stdout. Always exits 0 — this is a pure mapping,
# not a gate.

set -uo pipefail

PROD="${PROD:-}"
PROD_STATUS="${PROD_STATUS:-}"

# Prefer the job's own status output when the job ran cleanly (result success).
# That output disambiguates a real prod probe (`success`) from the empty-CSV
# skip (`skipped`) — both of which leave the job `result` as `success`. For any
# other result (failure, cancelled, skipped-because-upstream-aborted) the
# status output was never written, so surface the raw job result and never
# fabricate a success/skipped signal.
if [ "$PROD" = "success" ] && [ -n "$PROD_STATUS" ]; then
  echo "$PROD_STATUS"
else
  echo "$PROD"
fi
