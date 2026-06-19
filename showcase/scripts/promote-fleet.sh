#!/usr/bin/env bash
# promote-fleet.sh — run `bin/railway promote <svc>` for every service in a
# CSV, best-effort, and aggregate the result.
#
# Extracted from .github/workflows/showcase_promote.yml so the loop is
# unit-testable (see __tests__/promote-fleet.bats). The bug this fixes: the
# inline workflow loop ran under `set -e`, so the FIRST service whose promote
# exited non-zero aborted the entire loop — every later service in the CSV was
# left unpromoted. With `service=all`, one chronically-red service (e.g.
# showcase-ag2) blocked promoting the whole fleet.
#
# Behavior:
#   * Attempt EVERY service in the CSV regardless of individual failures.
#   * Capture each service's exit code into a succeeded-set / failed-set.
#   * Emit a clear end-of-run summary (stdout + GitHub Step Summary when
#     $GITHUB_STEP_SUMMARY is set).
#   * Exit non-zero iff ANY service failed — but only AFTER attempting all of
#     them. Exit zero only when every attempted service succeeded.
#
# Usage:
#   SERVICES_CSV="a,b,c" [DIGEST=ref] scripts/promote-fleet.sh
#
# Env:
#   SERVICES_CSV  (required)  comma-separated service names to promote.
#   DIGEST        (optional)  digest override; forwarded as `--digest <ref>`.
#                             Upstream resolve-targets already rejects
#                             --digest + 'all', so a populated DIGEST here
#                             always pairs with a single-service CSV.
#   RAILWAY_BIN   (optional)  path to the railway CLI (default: sibling
#                             ../bin/railway). Overridable for testing.
#
# NOTE: we intentionally do NOT pass --confirm-divergence; WARN-divergence
# refusals from bin/railway are a real signal and must fail the run.

# NB: deliberately NOT `set -e` — a non-zero `bin/railway promote` for one
# service must not abort the loop. We capture each exit code explicitly and
# compute the aggregate result ourselves. `set -uo pipefail` is still safe and
# catches unset-variable / pipeline bugs in our own logic.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(dirname "$HERE")"
RAILWAY_BIN="${RAILWAY_BIN:-$SHOWCASE_DIR/bin/railway}"

if [ -z "${SERVICES_CSV:-}" ]; then
  echo "::error::promote-fleet: SERVICES_CSV is empty; nothing to promote." >&2
  exit 1
fi

IFS=',' read -ra SVCS <<< "$SERVICES_CSV"

# Validate the railway CLI up front. Without this, a missing/non-executable
# binary makes EVERY iteration fail with 126/127, misattributing a single
# environment error as N per-service promote failures. `-x` covers an absolute
# path; `command -v` covers RAILWAY_BIN being a bare PATH command name.
if [ ! -x "$RAILWAY_BIN" ] && ! command -v "$RAILWAY_BIN" >/dev/null 2>&1; then
  echo "::error::promote-fleet: RAILWAY_BIN '$RAILWAY_BIN' is missing or not executable; cannot promote." >&2
  exit 1
fi

succeeded=()
failed=()        # "svc=exitcode" entries
drift=()         # aggregated STAGING_DRIFT_MARKER payloads across the fleet

for svc in "${SVCS[@]}"; do
  # Trim leading/trailing whitespace: `IFS=',' read` does NOT trim, so a CSV
  # like "svc-a, svc-c" yields a literal " svc-c" (leading space) that would be
  # promoted as a bogus service name. Trim BEFORE the empty-check so a
  # whitespace-only token is also correctly skipped.
  svc="${svc#"${svc%%[![:space:]]*}"}"   # strip leading whitespace
  svc="${svc%"${svc##*[![:space:]]}"}"   # strip trailing whitespace

  # Guard against empty tokens from a stray/trailing comma (or a whitespace-only
  # token) in the CSV.
  [ -n "$svc" ] || continue

  args=(promote "$svc" --yes --non-interactive)
  if [ -n "${DIGEST:-}" ]; then
    args+=(--digest "$DIGEST")
  fi

  echo "==> $RAILWAY_BIN ${args[*]}"
  # Tee the promote output so we (a) still stream it live to the operator/CI
  # log AND (b) can scan it for the STAGING_DRIFT_MARKER line that bin/railway
  # emits when staging is NOT serving the current :latest. PIPESTATUS[0] is the
  # railway exit code (tee always exits 0), so the per-service success/fail
  # accounting is unaffected by the pipe.
  out="$("$RAILWAY_BIN" "${args[@]}" 2>&1 | tee /dev/stderr)"
  rc="${PIPESTATUS[0]}"

  # Collect any drift marker(s) emitted for this service. The marker payload is
  # everything after "STAGING_DRIFT_MARKER: ". Promote still SUCCEEDS on drift
  # (it pins staging's running digest) — this is a warning surface, not a gate.
  while IFS= read -r line; do
    [ -n "$line" ] && drift+=("$line")
  done < <(printf '%s\n' "$out" | sed -n 's/^STAGING_DRIFT_MARKER: //p')

  if [ "$rc" -eq 0 ]; then
    echo "    OK: $svc"
    succeeded+=("$svc")
  else
    echo "::error::promote failed for '$svc' (exit $rc)"
    failed+=("$svc=$rc")
  fi
done

# Guard against a non-empty CSV that parsed to ONLY empty/whitespace tokens
# (e.g. ",," or " , "). Such input passes the SERVICES_CSV empty-check, skips
# every token in the loop, and would otherwise exit 0 claiming "All services
# promoted successfully" — a silent no-op false success. If zero services were
# actually attempted, fail loud.
attempted=$(( ${#succeeded[@]} + ${#failed[@]} ))
if [ "$attempted" -eq 0 ]; then
  echo "::error::promote-fleet: SERVICES_CSV contained no usable service names (only empty/whitespace tokens); nothing was promoted." >&2
  exit 1
fi

# ── Step output ────────────────────────────────────────────────────────────
# Export the SUCCEEDED set (comma-joined) so the downstream verify-prod job can
# scope its prod verification to only the services that actually promoted — not
# the full requested set (which would include any failed service and guarantee
# a red verify) and not nothing (which would skip verification of the services
# that DID promote). Guarded so a local/bats run with no $GITHUB_OUTPUT is a
# no-op. Uses the same `key=value >> "$GITHUB_OUTPUT"` idiom as the workflow.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  succeeded_csv=""
  if [ "${#succeeded[@]}" -gt 0 ]; then
    succeeded_csv=$(IFS=,; echo "${succeeded[*]}")
  fi
  # Fail loud on a failed redirect. Under `set -uo pipefail` (no `-e`) a failed
  # append would otherwise be silently discarded, leaving verify-prod scoping
  # unreliable (an absent succeeded_csv key it depends on).
  if ! echo "succeeded_csv=$succeeded_csv" >> "$GITHUB_OUTPUT"; then
    echo "::error::promote-fleet: failed to write succeeded_csv to \$GITHUB_OUTPUT ('$GITHUB_OUTPUT')." >&2
    exit 1
  fi
  # Aggregated staging-drift payload (one line, services semicolon-joined) so
  # the notify job can fold "staging was NOT serving :latest" into the Slack
  # message. Empty when no service drifted (the common case).
  staging_drift=""
  if [ "${#drift[@]}" -gt 0 ]; then
    # Join with "; " between entries. `${drift[*]}` with IFS='; ' would only use
    # the FIRST IFS char (';'), dropping the space; build the separator explicitly.
    printf -v staging_drift '%s; ' "${drift[@]}"
    staging_drift="${staging_drift%; }"
  fi
  if ! echo "staging_drift=$staging_drift" >> "$GITHUB_OUTPUT"; then
    echo "::error::promote-fleet: failed to write staging_drift to \$GITHUB_OUTPUT ('$GITHUB_OUTPUT')." >&2
    exit 1
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────
emit() {
  # Echo to stdout AND, when running in GitHub Actions, append to the step
  # summary so the result is visible in the run UI.
  echo "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

emit "## Promote fleet summary"
# Report services ACTUALLY attempted (succeeded + failed), not the raw CSV
# token count — which would over-count empty/whitespace tokens skipped above.
emit "Attempted ${attempted} service(s) from SERVICES_CSV."

if [ "${#succeeded[@]}" -gt 0 ]; then
  emit "SUCCEEDED (${#succeeded[@]}): ${succeeded[*]}"
else
  emit "SUCCEEDED (0): (none)"
fi

if [ "${#drift[@]}" -gt 0 ]; then
  emit ""
  emit "⚠️ STAGING DRIFT (${#drift[@]}): staging was NOT serving current :latest for — ${drift[*]}"
  emit "Promote pinned prod to staging's RUNNING digest (what was seen in staging); investigate the drift."
fi

if [ "${#failed[@]}" -gt 0 ]; then
  emit "FAILED (${#failed[@]}): ${failed[*]}"
  emit ""
  emit "One or more services failed to promote; marking the run failed so the notify job fires."
  exit 1
fi

emit "FAILED (0): (none)"
emit ""
emit "All services promoted successfully."
exit 0
