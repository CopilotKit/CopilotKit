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
#   # legacy flat leaf set (backward-compat):
#   SERVICES_CSV="a,b,c" [DIGEST=ref] scripts/promote-fleet.sh
#   # tier-ordered closure (U4 — preferred for `all`/equivalence-gated promotes):
#   CLOSURE_PLAN="0:aimock,1:harness,2:langgraph-python" [DIGEST=ref] scripts/promote-fleet.sh
#
# Env:
#   CLOSURE_PLAN  (optional)  tier-annotated `tier:name,tier:name,...` plan from
#                             U3's resolve-promote-targets.sh (the `closure_plan`
#                             output). When set, the fleet is promoted BY TIER
#                             (0->1->2) and a tier GATES its dependents: if ANY
#                             service in a tier fails pin+verify, every LATER
#                             tier is NOT promoted (reported NOT-ATTEMPTED, not
#                             FAILED — so the operator can re-run once the
#                             failing tier is healthy, spec R-B). Within a tier
#                             the existing per-service best-effort loop is
#                             preserved exactly. Takes precedence over
#                             SERVICES_CSV when both are set.
#   SERVICES_CSV  (optional*) comma-separated service names to promote, flat /
#                             best-effort with NO tier gating (the legacy leaf
#                             path). Required when CLOSURE_PLAN is unset.
#   DIGEST        (optional)  digest override; forwarded as `--digest <ref>`.
#                             Upstream resolve-targets already rejects
#                             --digest + 'all', so a populated DIGEST here
#                             always pairs with a single-service set.
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

# ── Input mode resolution ───────────────────────────────────────────────────
# Two input shapes:
#   * CLOSURE_PLAN — tier-annotated `tier:name,tier:name,...` (U3 output). When
#     present, the fleet is promoted BY TIER with dependent-tier gating.
#   * SERVICES_CSV — flat comma-separated leaf set (legacy / backward-compat),
#     best-effort with NO tier gating.
# CLOSURE_PLAN takes precedence when both are set.
if [ -z "${CLOSURE_PLAN:-}" ] && [ -z "${SERVICES_CSV:-}" ]; then
  echo "::error::promote-fleet: neither CLOSURE_PLAN nor SERVICES_CSV is set; nothing to promote." >&2
  exit 1
fi

# Validate the railway CLI up front. Without this, a missing/non-executable
# binary makes EVERY iteration fail with 126/127, misattributing a single
# environment error as N per-service promote failures. `-x` covers an absolute
# path; `command -v` covers RAILWAY_BIN being a bare PATH command name.
if [ ! -x "$RAILWAY_BIN" ] && ! command -v "$RAILWAY_BIN" >/dev/null 2>&1; then
  echo "::error::promote-fleet: RAILWAY_BIN '$RAILWAY_BIN' is missing or not executable; cannot promote." >&2
  exit 1
fi

succeeded=()       # service names that actually pinned (the closure subset)
failed=()          # "svc=exitcode" entries
not_attempted=()   # services in tiers gated out by an earlier-tier failure
drift=()           # aggregated STAGING_DRIFT_MARKER payloads across the fleet

# trim <var-of-string> -> echoes the string with leading/trailing whitespace
# stripped. `IFS=',' read` does NOT trim, so a token like " svc-c" (leading
# space) would be promoted as a bogus service name; strip it consistently on
# both the flat and the tiered paths.
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"   # strip leading whitespace
  s="${s%"${s##*[![:space:]]}"}"   # strip trailing whitespace
  printf '%s' "$s"
}

# promote_one <svc> -> promote a single service best-effort, recording it into
# succeeded[]/failed[] and aggregating any STAGING_DRIFT_MARKER into drift[].
# Returns the railway exit code (0 = pinned). This is the EXACT per-service body
# the flat loop used before tiering was added — preserved byte-for-byte so the
# behavior (trim handled by caller, args, PIPESTATUS rc capture, drift scan,
# OK/::error:: lines) is identical on both paths.
promote_one() {
  local svc="$1"
  local args out rc line

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
  return "$rc"
}

if [ -n "${CLOSURE_PLAN:-}" ]; then
  # ── Tier-ordered closure path (U4) ──────────────────────────────────────────
  # Parse `tier:name` tokens into per-tier service lists, then promote tier 0,
  # then 1, then 2. A tier GATES its dependents: once any tier records a
  # failure, every LATER tier is NOT attempted — its services are recorded as
  # not_attempted[] (distinct from failed[]) so the operator can re-run them
  # once the failing tier is healthy (spec R-B). A stale aimock/harness under
  # fresh integrations is a non-equivalent prod, so the leaf tiers must not pin.
  # Three per-tier service lists. NB we deliberately AVOID bash 4.3 `declare -n`
  # namerefs here: CI runs on ubuntu bash 5 but contributors/maintainers run the
  # bats suite on macOS system bash 3.2, which lacks namerefs. Iterate each tier
  # array explicitly so the script stays portable to bash 3.2.
  tier0=()
  tier1=()
  tier2=()
  IFS=',' read -ra PLAN_TOKENS <<< "$CLOSURE_PLAN"
  for tok in "${PLAN_TOKENS[@]}"; do
    tok="$(trim "$tok")"
    [ -n "$tok" ] || continue
    # Split `tier:name`; the tier is the part before the FIRST colon.
    tier="${tok%%:*}"
    svc="$(trim "${tok#*:}")"
    [ -n "$svc" ] || continue
    case "$tier" in
      0) tier0+=("$svc") ;;
      1) tier1+=("$svc") ;;
      2) tier2+=("$svc") ;;
      *)
        echo "::error::promote-fleet: CLOSURE_PLAN token '$tok' has an unknown tier '$tier' (expected 0, 1, or 2)." >&2
        exit 1
        ;;
    esac
  done

  # promote_tier <gated> <svc...> — promote every service in one tier
  # best-effort (unless <gated> is 1, in which case the tier is gated out by an
  # earlier-tier failure and its services are recorded NOT-ATTEMPTED). Sets the
  # GLOBAL `tier_had_failure` to 1 if this tier itself had a promote failure (so
  # the caller can gate the NEXT tier), else 0. Best-effort within the tier is
  # preserved: every member is attempted even after a sibling fails.
  #
  # NB: this MUST run in the current shell (NOT a `$(...)` command substitution)
  # — promote_one appends to the succeeded[]/failed[]/drift[] arrays, and those
  # mutations would be lost in a subshell. We communicate the tier result via a
  # global rather than stdout for the same reason.
  promote_tier() {
    local gated_in="$1"; shift
    local svc
    tier_had_failure=0
    for svc in "$@"; do
      # Skip the empty arg an empty tier yields via `${arr[@]:-}` on bash 3.2
      # (and any blank that slipped through). A blank is never a real service.
      [ -n "$svc" ] || continue
      if [ "$gated_in" -ne 0 ]; then
        not_attempted+=("$svc")
        continue
      fi
      # promote_one returns the railway rc; under `set -uo pipefail` (no -e) a
      # non-zero return does NOT abort, so per-service best-effort within the
      # tier is preserved.
      if ! promote_one "$svc"; then
        tier_had_failure=1
      fi
    done
  }

  # Promote in strict tier order (0 -> 1 -> 2), gating each tier's dependents on
  # ANY earlier-tier failure. `${arr[@]:-}` keeps the empty-array expansion safe
  # under `set -u` on bash 3.2 (an empty tier expands to a single empty arg,
  # which promote_tier skips via promote_one's no-op on "" — see below).
  gated=0
  tier_had_failure=0
  promote_tier "$gated" "${tier0[@]:-}"
  [ "$tier_had_failure" -ne 0 ] && gated=1
  promote_tier "$gated" "${tier1[@]:-}"
  [ "$tier_had_failure" -ne 0 ] && gated=1
  promote_tier "$gated" "${tier2[@]:-}"
else
  # ── Flat leaf path (legacy / backward-compat) ──────────────────────────────
  # No tier gating: every service attempted best-effort, identical to the
  # pre-U4 behavior. not_attempted[] stays empty on this path.
  IFS=',' read -ra SVCS <<< "$SERVICES_CSV"
  for svc in "${SVCS[@]}"; do
    # Trim BEFORE the empty-check so a whitespace-only token is also skipped.
    svc="$(trim "$svc")"
    # Guard against empty tokens from a stray/trailing comma (or a
    # whitespace-only token) in the CSV.
    [ -n "$svc" ] || continue
    promote_one "$svc" || true
  done
fi

# Guard against input that parsed to ONLY empty/whitespace tokens (e.g. ",,"
# or " , ", or a CLOSURE_PLAN of all blank tokens). Such input passes the
# upfront empty-check, skips every token in the loop, and would otherwise exit 0
# claiming "All services promoted successfully" — a silent no-op false success.
# If zero services were actually attempted, fail loud.
#
# NOTE: not_attempted[] (tiers gated out by an earlier-tier failure) is NOT an
# "attempt" — those services were deliberately NOT promoted. But a gated run
# ALWAYS has at least one failed[] entry (the tier failure that triggered the
# gate), so `attempted` is non-zero there; this guard only trips on genuinely
# empty input.
attempted=$(( ${#succeeded[@]} + ${#failed[@]} ))
if [ "$attempted" -eq 0 ]; then
  if [ -n "${CLOSURE_PLAN:-}" ]; then
    echo "::error::promote-fleet: CLOSURE_PLAN contained no usable service names (only empty/whitespace tokens); nothing was promoted." >&2
  else
    echo "::error::promote-fleet: SERVICES_CSV contained no usable service names (only empty/whitespace tokens); nothing was promoted." >&2
  fi
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
# Report services ACTUALLY attempted (succeeded + failed), not the raw input
# token count — which would over-count empty/whitespace tokens skipped above.
if [ -n "${CLOSURE_PLAN:-}" ]; then
  emit "Attempted ${attempted} service(s) from CLOSURE_PLAN (tier-ordered)."
else
  emit "Attempted ${attempted} service(s) from SERVICES_CSV."
fi

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

# NOT-ATTEMPTED: services in tiers gated out by an earlier-tier failure. These
# are DISTINCT from FAILED — the services were never promoted (so prod was left
# untouched), and the operator can re-run them once the failing tier is healthy
# (spec R-B). Only populated on the tier-ordered CLOSURE_PLAN path.
if [ "${#not_attempted[@]}" -gt 0 ]; then
  emit ""
  emit "NOT-ATTEMPTED (${#not_attempted[@]}): ${not_attempted[*]}"
  emit "These tiers were gated by an earlier-tier failure and NOT promoted; re-run once the failing tier is healthy."
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
