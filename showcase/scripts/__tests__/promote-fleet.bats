#!/usr/bin/env bats
# Tests for promote-fleet.sh — the per-service promote loop extracted from
# .github/workflows/showcase_promote.yml.
#
# Core invariant under test (the bug this script fixes): a single red service
# must NOT abort the fleet. Every service in the CSV is attempted regardless of
# individual failures; the run aggregates a failed-set + succeeded-set, prints a
# summary, and exits non-zero iff ANY service failed.
#
# The real `bin/railway` is replaced on PATH-independent terms via RAILWAY_BIN,
# pointed at a stub that succeeds/fails per service name.
#
# NB on assertion gating: bats does NOT run test bodies under `set -e` (errexit).
# Only the FINAL command's exit status decides whether a test passes — a non-zero
# command on any earlier line does NOT abort the test. So a bare `[[ ... ]]` on a
# non-final line is a silent no-op: if it's false, nothing fails. That is why every
# substantive / non-final assertion MUST be written `[[ ... ]] || fail "message"`.
# The `|| fail` is what actually forces the hard failure (and supplies the
# diagnostic MESSAGE) when the check is violated — e.g. a service missing from
# $GITHUB_OUTPUT reports WHY it failed instead of being silently passed over.
# Dropping the `|| fail` from an intermediate assertion turns it into a false-green.

# fail <msg> — print the message to the bats failure stream and abort the test.
fail() {
  echo "$1" >&2
  return 1
}

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../promote-fleet.sh"
  STUB_DIR="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$STUB_DIR"

  # Capture the per-step GitHub Actions output to a temp file so the script's
  # `$GITHUB_OUTPUT` append (succeeded_csv=...) runs exactly as it would in CI.
  # Each test reads this file to assert the exported succeeded set.
  export GITHUB_OUTPUT="$BATS_TEST_TMPDIR/github_output"
  : > "$GITHUB_OUTPUT"

  # Stub `railway`: invoked as `railway promote <svc> [flags...]`.
  # Succeeds for A and C, fails (exit 7) for B. Echoes its service so we can
  # assert every service was attempted (including C, AFTER B failed). Also
  # asserts the FIRST positional arg is literally `promote` so an arg-order
  # regression in the script (e.g. dropping the subcommand) is caught.
  cat > "$STUB_DIR/railway" <<'STUB'
#!/usr/bin/env bash
# args: promote <svc> --yes --non-interactive [--digest REF]
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
svc="$2"
echo "STUB called for: $svc"
case "$svc" in
  svc-b) exit 7 ;;   # chronically-red service (the abort trigger pre-fix)
  *)     exit 0 ;;
esac
STUB
  chmod +x "$STUB_DIR/railway"
  export RAILWAY_BIN="$STUB_DIR/railway"

  # All-green stub for the success case.
  cat > "$STUB_DIR/railway-green" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
echo "STUB called for: $2"
exit 0
STUB
  chmod +x "$STUB_DIR/railway-green"
}

@test "attempts every service even after one fails, and exits non-zero" {
  run env SERVICES_CSV="svc-a,svc-b,svc-c" bash "$SCRIPT"

  # (1) all three attempted — C runs even though B failed before it
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "svc-a not attempted: $output"
  [[ "$output" == *"STUB called for: svc-b"* ]] || fail "svc-b not attempted: $output"
  [[ "$output" == *"STUB called for: svc-c"* ]] || fail "svc-c not attempted: $output"

  # (2) non-zero aggregate exit because at least one service failed
  [ "$status" -ne 0 ] || fail "expected non-zero exit, got $status"

  # (3) summary classifies B as failed, A and C as succeeded. Anchor to the
  #     EXACT summary lines (not bare substrings) so a misclassification (e.g.
  #     svc-b leaking into the succeeded set) is actually caught.
  [[ "$output" == *"FAILED (1): svc-b=7"* ]] || fail "wrong FAILED summary line: $output"
  [[ "$output" == *"SUCCEEDED (2): svc-a svc-c"* ]] || fail "wrong SUCCEEDED summary line: $output"

  # (4) the succeeded set is exported to $GITHUB_OUTPUT for verify-prod scoping.
  #     Only the services that actually promoted (a and c) — never the failed b.
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a,svc-c"* ]] || fail "missing/wrong succeeded_csv: $output"
  [[ "$output" != *"svc-b"* ]] || fail "failed svc-b leaked into GITHUB_OUTPUT: $output"
}

@test "all-green fleet exits zero" {
  export RAILWAY_BIN="$STUB_DIR/railway-green"
  run env SERVICES_CSV="svc-a,svc-b,svc-c" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "svc-a not attempted: $output"
  [[ "$output" == *"STUB called for: svc-b"* ]] || fail "svc-b not attempted: $output"
  [[ "$output" == *"STUB called for: svc-c"* ]] || fail "svc-c not attempted: $output"

  # All three exported as the succeeded set.
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a,svc-b,svc-c"* ]] || fail "wrong succeeded_csv: $output"
}

@test "stray/trailing commas in CSV are skipped; real services still attempted" {
  export RAILWAY_BIN="$STUB_DIR/railway-green"
  run env SERVICES_CSV="svc-a,,svc-c" bash "$SCRIPT"

  # Both non-empty services attempted; empty token between the commas ignored.
  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "svc-a not attempted: $output"
  [[ "$output" == *"STUB called for: svc-c"* ]] || fail "svc-c not attempted: $output"
  [[ "$output" == *"SUCCEEDED (2): svc-a svc-c"* ]] || fail "wrong SUCCEEDED summary line: $output"

  # The "Attempted N" count must reflect services ACTUALLY attempted (2), not
  # the raw CSV token count (3, including the empty token between the commas).
  [[ "$output" == *"Attempted 2 service(s)"* ]] || fail "wrong Attempted count (should skip empty token): $output"

  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a,svc-c"* ]] || fail "wrong succeeded_csv: $output"
}

@test "single failing service still fails the run" {
  run env SERVICES_CSV="svc-b" bash "$SCRIPT"

  [ "$status" -ne 0 ] || fail "expected non-zero exit, got $status"
  [[ "$output" == *"STUB called for: svc-b"* ]] || fail "svc-b not attempted: $output"
  [[ "$output" == *"FAILED (1): svc-b=7"* ]] || fail "wrong FAILED summary line: $output"
}

@test "all-fail run still exports an EMPTY succeeded_csv to GITHUB_OUTPUT" {
  # verify-prod's empty-guard depends on the key being present-but-empty on the
  # all-fail-via-promote path (the loop ran, every service failed, zero
  # promoted) — an absent key (vs an empty value) is a different contract and
  # would break downstream scoping. NB this empty-but-present contract holds for
  # the all-fail path only; the script's early-exit guards (empty CSV / missing
  # RAILWAY_BIN / all-empty-token) exit BEFORE the $GITHUB_OUTPUT write, so no
  # key is emitted there. Assert key present, value empty.
  run env SERVICES_CSV="svc-b" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit, got $status: $output"

  run grep '^succeeded_csv=' "$GITHUB_OUTPUT"
  [ "$status" -eq 0 ] || fail "succeeded_csv key missing from GITHUB_OUTPUT"
  # The value must be EMPTY: the line is exactly `succeeded_csv=` (no service).
  [ "$output" = "succeeded_csv=" ] || fail "succeeded_csv should be empty on all-fail, got: $output"
}

@test "single succeeding service exits zero" {
  run env SERVICES_CSV="svc-a" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "svc-a not attempted: $output"
}

@test "passes --digest through to railway for a single service" {
  # Stub that asserts --digest is forwarded AND the first arg is `promote`.
  cat > "$STUB_DIR/railway-digest" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
echo "ARGS: $*"
[[ "$*" == *"--digest sha256:deadbeef"* ]] || { echo "missing digest" >&2; exit 9; }
exit 0
STUB
  chmod +x "$STUB_DIR/railway-digest"
  export RAILWAY_BIN="$STUB_DIR/railway-digest"

  run env SERVICES_CSV="svc-a" DIGEST="sha256:deadbeef" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  # Anchor to the STUB's received-args marker (`ARGS: ...`), NOT the script's
  # pre-invocation `==> ...` echo. The pre-invocation echo would pass even if
  # the script dropped --digest before actually invoking railway; only the
  # stub's ARGS line proves the flag was forwarded to the real invocation.
  [[ "$output" == *"ARGS: "*"--digest sha256:deadbeef"* ]] || fail "digest not forwarded to railway invocation: $output"
}

@test "empty CSV fails loud rather than silently succeeding" {
  run env SERVICES_CSV="" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on empty CSV, got $status"
}

@test "all-empty-token CSV fails loud rather than silently no-op succeeding" {
  # A non-empty CSV that parses to ONLY empty tokens (e.g. ",,") must NOT exit 0
  # claiming success — every token is skipped, zero services are attempted, and
  # that is a false success the empty-string guard alone does not catch.
  export RAILWAY_BIN="$STUB_DIR/railway-green"
  run env SERVICES_CSV=",," bash "$SCRIPT"

  [ "$status" -ne 0 ] || fail "expected non-zero exit on all-empty-token CSV, got $status: $output"
  [[ "$output" != *"STUB called for:"* ]] || fail "no service should have been attempted: $output"
  [[ "$output" == *"::error::"* ]] || fail "expected an ::error:: for zero-attempted CSV: $output"
}

@test "missing/non-executable RAILWAY_BIN fails loud before attempting any service" {
  # A bad RAILWAY_BIN would otherwise make every iteration fail with 126/127 and
  # misreport a single environment error as N per-service promote failures.
  run env RAILWAY_BIN="$STUB_DIR/does-not-exist" SERVICES_CSV="svc-a,svc-c" bash "$SCRIPT"

  [ "$status" -ne 0 ] || fail "expected non-zero exit on missing RAILWAY_BIN, got $status: $output"
  [[ "$output" == *"::error::"* ]] || fail "expected a distinct ::error:: naming the missing binary: $output"
  [[ "$output" == *"does-not-exist"* ]] || fail "error should name the missing binary: $output"
  # The guard fires BEFORE the loop: no per-service promote was attempted.
  [[ "$output" != *"==> "* ]] || fail "no service promote should have been attempted: $output"
  [[ "$output" != *"promote failed for"* ]] || fail "env error misattributed as per-service failure: $output"
}

@test "whitespace around tokens is trimmed; trimmed names are attempted" {
  # `IFS=',' read` does not trim, so "svc-a, svc-c" yields a literal " svc-c"
  # (leading space). The script must trim so the REAL service name is promoted.
  export RAILWAY_BIN="$STUB_DIR/railway-green"
  run env SERVICES_CSV="svc-a, svc-c" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "svc-a not attempted: $output"
  # Trimmed: stub receives `svc-c`, NOT ` svc-c`.
  [[ "$output" == *"STUB called for: svc-c"* ]] || fail "svc-c not attempted (trimmed): $output"
  [[ "$output" != *"STUB called for:  svc-c"* ]] || fail "leading space not trimmed from token: $output"
  [[ "$output" == *"SUCCEEDED (2): svc-a svc-c"* ]] || fail "wrong SUCCEEDED summary line: $output"

  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a,svc-c"* ]] || fail "wrong succeeded_csv (trimmed): $output"
}

@test "whitespace-only token is correctly skipped" {
  # A token of only whitespace (the middle " " in "svc-a, ,svc-c") must be
  # treated like an empty token and skipped — not promoted as a blank service.
  export RAILWAY_BIN="$STUB_DIR/railway-green"
  run env SERVICES_CSV="svc-a, ,svc-c" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" == *"SUCCEEDED (2): svc-a svc-c"* ]] || fail "whitespace-only token not skipped: $output"
  [[ "$output" == *"Attempted 2 service(s)"* ]] || fail "wrong Attempted count: $output"
}

@test "aggregates STAGING_DRIFT_MARKER lines into staging_drift output + summary" {
  # Stub that emits a drift marker for svc-b (staging not serving :latest) while
  # still SUCCEEDING — drift is a warning surface, not a gate. The script must
  # scan each promote's stdout, aggregate the markers, write them to
  # $GITHUB_OUTPUT (staging_drift=...) and surface them in the summary.
  cat > "$STUB_DIR/railway-drift" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
svc="$2"
echo "STUB called for: $svc"
if [ "$svc" = "svc-b" ]; then
  echo "STAGING_DRIFT_MARKER: svc-b(running=f9454e79fbf5,latest=261ccdef3f9a)"
fi
exit 0
STUB
  chmod +x "$STUB_DIR/railway-drift"
  export RAILWAY_BIN="$STUB_DIR/railway-drift"
  run env SERVICES_CSV="svc-a,svc-b,svc-c" bash "$SCRIPT"

  # Drift does not fail the run (every service succeeded).
  [ "$status" -eq 0 ] || fail "drift must not fail the run, got $status: $output"
  # Summary surfaces the drift loudly and names the running/latest digests.
  [[ "$output" == *"STAGING DRIFT (1)"* ]] || fail "missing drift summary block: $output"
  [[ "$output" == *"running=f9454e79fbf5"* ]] || fail "summary missing RUNNING digest: $output"
  [[ "$output" == *"latest=261ccdef3f9a"* ]] || fail "summary missing :latest digest: $output"

  # The aggregated payload is exported for the notify job's Slack message.
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"staging_drift=svc-b(running=f9454e79fbf5,latest=261ccdef3f9a)"* ]] \
    || fail "missing/wrong staging_drift in GITHUB_OUTPUT: $output"
}

@test "joins multiple STAGING_DRIFT_MARKER entries with '; ' separator" {
  # Two services drift. The aggregated staging_drift payload must join the
  # entries with "; " (semicolon + space), NOT ";" — `${drift[*]}` under
  # IFS='; ' would only honor the first IFS char and drop the space.
  cat > "$STUB_DIR/railway-drift2" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
svc="$2"
echo "STUB called for: $svc"
if [ "$svc" = "svc-a" ]; then
  echo "STAGING_DRIFT_MARKER: svc-a(running=aaaaaaaaaaaa,latest=bbbbbbbbbbbb)"
fi
if [ "$svc" = "svc-c" ]; then
  echo "STAGING_DRIFT_MARKER: svc-c(running=cccccccccccc,latest=dddddddddddd)"
fi
exit 0
STUB
  chmod +x "$STUB_DIR/railway-drift2"
  export RAILWAY_BIN="$STUB_DIR/railway-drift2"
  run env SERVICES_CSV="svc-a,svc-b,svc-c" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "drift must not fail the run, got $status: $output"
  [[ "$output" == *"STAGING DRIFT (2)"* ]] || fail "missing drift summary block: $output"

  run cat "$GITHUB_OUTPUT"
  # Both entries present, joined with "; " (NOT ";" — the dropped-space bug).
  [[ "$output" == *"staging_drift=svc-a(running=aaaaaaaaaaaa,latest=bbbbbbbbbbbb); svc-c(running=cccccccccccc,latest=dddddddddddd)"* ]] \
    || fail "multi-entry drift not joined with '; ' separator: $output"
}

@test "no drift markers -> empty staging_drift output, no drift summary" {
  export RAILWAY_BIN="$STUB_DIR/railway-green"
  run env SERVICES_CSV="svc-a,svc-b,svc-c" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" != *"STAGING DRIFT"* ]] || fail "no drift expected but summary shows one: $output"

  run cat "$GITHUB_OUTPUT"
  # Key present but empty (the non-drift contract): staging_drift=
  [[ "$output" == *"staging_drift="* ]] || fail "staging_drift key absent: $output"
  [[ "$output" != *"staging_drift=svc"* ]] || fail "unexpected drift payload: $output"
}

# ── U4: tier-ordered closure promote with dependent-tier gating ─────────────
#
# When CLOSURE_PLAN (tier-annotated `tier:name,tier:name,...` from U3's
# resolve-promote-targets.sh) is supplied, promote-fleet iterates the closure
# BY TIER (0->1->2). The existing per-service best-effort loop is preserved
# WITHIN a tier, but a tier GATES its dependents: if ANY tier-0 service fails
# pin+verify, tiers 1 and 2 do NOT promote (a stale aimock/harness under fresh
# integrations = non-equivalent prod); a tier-1 failure blocks tier-2. Blocked
# tiers are reported NOT-ATTEMPTED (distinct from FAILED) so the operator can
# re-run (spec R-B). succeeded_csv = the actually-pinned closure subset.

# A per-tier stub: tier-0 = aimock(svc-a)/pocketbase(svc-b); tier-1 =
# harness(svc-h); tier-2 = integrations(svc-i1,svc-i2). svc-fail always fails.
setup_tier_stub() {
  cat > "$STUB_DIR/railway-tier" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
svc="$2"
echo "STUB called for: $svc"
case "$svc" in
  svc-fail) exit 7 ;;
  *)        exit 0 ;;
esac
STUB
  chmod +x "$STUB_DIR/railway-tier"
  export RAILWAY_BIN="$STUB_DIR/railway-tier"
}

@test "U4: tier-0 failure HALTS tiers 1 and 2 (reported NOT-ATTEMPTED, not failed)" {
  setup_tier_stub
  # tier-0: svc-fail (fails) + svc-a (ok); tier-1: svc-h; tier-2: svc-i1,svc-i2.
  run env CLOSURE_PLAN="0:svc-fail,0:svc-a,1:svc-h,2:svc-i1,2:svc-i2" bash "$SCRIPT"

  # tier-0 members ARE attempted (best-effort within the failing tier).
  [[ "$output" == *"STUB called for: svc-fail"* ]] || fail "tier-0 svc-fail not attempted: $output"
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "tier-0 svc-a not attempted: $output"

  # tiers 1 and 2 are NOT attempted — the tier-0 failure gated them.
  [[ "$output" != *"STUB called for: svc-h"* ]] || fail "tier-1 svc-h should NOT have been attempted after tier-0 failure: $output"
  [[ "$output" != *"STUB called for: svc-i1"* ]] || fail "tier-2 svc-i1 should NOT have been attempted after tier-0 failure: $output"
  [[ "$output" != *"STUB called for: svc-i2"* ]] || fail "tier-2 svc-i2 should NOT have been attempted after tier-0 failure: $output"

  # Non-zero aggregate exit (a tier-0 service failed).
  [ "$status" -ne 0 ] || fail "expected non-zero exit on tier-0 failure, got $status: $output"

  # Blocked tiers reported as NOT-ATTEMPTED — distinct from FAILED so the
  # operator knows they can re-run them once tier-0 is healthy.
  [[ "$output" == *"NOT-ATTEMPTED"* ]] || fail "expected a NOT-ATTEMPTED report for gated tiers: $output"
  [[ "$output" == *"svc-h"* ]] || fail "gated svc-h should be named in NOT-ATTEMPTED: $output"
  [[ "$output" == *"svc-i1"* ]] || fail "gated svc-i1 should be named in NOT-ATTEMPTED: $output"
  [[ "$output" == *"svc-i2"* ]] || fail "gated svc-i2 should be named in NOT-ATTEMPTED: $output"

  # succeeded_csv = actually-pinned subset (only svc-a; NOT the gated tiers,
  # NOT the failed svc-fail).
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a"* ]] || fail "succeeded_csv should be exactly the pinned subset (svc-a): $output"
  [[ "$output" != *"svc-h"* ]] || fail "gated svc-h must not leak into succeeded_csv: $output"
  [[ "$output" != *"svc-fail"* ]] || fail "failed svc-fail must not leak into succeeded_csv: $output"
}

@test "U4: tier-1 failure blocks tier-2 (tier-0 still promoted)" {
  setup_tier_stub
  # tier-0: svc-a (ok); tier-1: svc-fail (fails); tier-2: svc-i1.
  run env CLOSURE_PLAN="0:svc-a,1:svc-fail,2:svc-i1" bash "$SCRIPT"

  # tier-0 + tier-1 attempted.
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "tier-0 svc-a not attempted: $output"
  [[ "$output" == *"STUB called for: svc-fail"* ]] || fail "tier-1 svc-fail not attempted: $output"
  # tier-2 NOT attempted (gated by the tier-1 failure).
  [[ "$output" != *"STUB called for: svc-i1"* ]] || fail "tier-2 svc-i1 should NOT have been attempted after tier-1 failure: $output"

  [ "$status" -ne 0 ] || fail "expected non-zero exit on tier-1 failure, got $status: $output"
  [[ "$output" == *"NOT-ATTEMPTED"* ]] || fail "expected NOT-ATTEMPTED report for gated tier-2: $output"
  [[ "$output" == *"svc-i1"* ]] || fail "gated svc-i1 should be named in NOT-ATTEMPTED: $output"

  # tier-0 svc-a DID pin even though tier-1 later failed.
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a"* ]] || fail "tier-0 svc-a should be in succeeded_csv: $output"
}

@test "U4: all-green closure promotes every tier in order (0 before 1 before 2)" {
  setup_tier_stub
  run env CLOSURE_PLAN="0:svc-a,0:svc-b,1:svc-h,2:svc-i1,2:svc-i2" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit on all-green closure, got $status: $output"

  # Every service attempted.
  for s in svc-a svc-b svc-h svc-i1 svc-i2; do
    [[ "$output" == *"STUB called for: $s"* ]] || fail "$s not attempted: $output"
  done

  # Tier ordering: tier-0 services appear BEFORE tier-1, which appears BEFORE
  # tier-2. Use the byte offset of each STUB line in $output to assert order.
  a_pos="${output%%STUB called for: svc-a*}"
  h_pos="${output%%STUB called for: svc-h*}"
  i1_pos="${output%%STUB called for: svc-i1*}"
  [ "${#a_pos}" -lt "${#h_pos}" ] || fail "tier-0 svc-a must promote BEFORE tier-1 svc-h: $output"
  [ "${#h_pos}" -lt "${#i1_pos}" ] || fail "tier-1 svc-h must promote BEFORE tier-2 svc-i1: $output"

  # All five exported as the succeeded set, in tier order.
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a,svc-b,svc-h,svc-i1,svc-i2"* ]] || fail "wrong succeeded_csv: $output"
}

@test "U4: a tier-2 (leaf) failure does NOT gate anything; best-effort within the leaf tier" {
  setup_tier_stub
  # tier-0 ok, tier-1 ok, tier-2: svc-fail (fails) + svc-i1 (ok). The leaf tier
  # has no dependents, so svc-i1 must STILL be attempted after svc-fail fails
  # (the existing best-effort-within-a-tier behavior).
  run env CLOSURE_PLAN="0:svc-a,1:svc-h,2:svc-fail,2:svc-i1" bash "$SCRIPT"

  [[ "$output" == *"STUB called for: svc-fail"* ]] || fail "tier-2 svc-fail not attempted: $output"
  [[ "$output" == *"STUB called for: svc-i1"* ]] || fail "tier-2 svc-i1 not attempted after a sibling failed (best-effort): $output"
  [ "$status" -ne 0 ] || fail "expected non-zero exit (a service failed), got $status: $output"

  run cat "$GITHUB_OUTPUT"
  # svc-i1 pinned despite its sibling failing; svc-fail not in succeeded_csv.
  [[ "$output" == *"succeeded_csv=svc-a,svc-h,svc-i1"* ]] || fail "wrong succeeded_csv (leaf best-effort): $output"
}

@test "U4: --digest override still works on the single-service closure path" {
  # R-B: the single-service --digest escape path must survive the tier path.
  cat > "$STUB_DIR/railway-tier-digest" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
echo "ARGS: $*"
[[ "$*" == *"--digest sha256:deadbeef"* ]] || { echo "missing digest" >&2; exit 9; }
exit 0
STUB
  chmod +x "$STUB_DIR/railway-tier-digest"
  export RAILWAY_BIN="$STUB_DIR/railway-tier-digest"

  run env CLOSURE_PLAN="2:svc-a" DIGEST="sha256:deadbeef" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" == *"ARGS: "*"--digest sha256:deadbeef"* ]] || fail "digest not forwarded on closure path: $output"
}

@test "U4: STAGING_DRIFT_MARKER aggregation works on the tier path too" {
  cat > "$STUB_DIR/railway-tier-drift" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
svc="$2"
echo "STUB called for: $svc"
if [ "$svc" = "svc-h" ]; then
  echo "STAGING_DRIFT_MARKER: svc-h(running=f9454e79fbf5,latest=261ccdef3f9a)"
fi
exit 0
STUB
  chmod +x "$STUB_DIR/railway-tier-drift"
  export RAILWAY_BIN="$STUB_DIR/railway-tier-drift"

  run env CLOSURE_PLAN="0:svc-a,1:svc-h,2:svc-i1" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "drift must not fail the run, got $status: $output"
  [[ "$output" == *"STAGING DRIFT (1)"* ]] || fail "missing drift summary block on tier path: $output"

  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"staging_drift=svc-h(running=f9454e79fbf5,latest=261ccdef3f9a)"* ]] \
    || fail "missing/wrong staging_drift on tier path: $output"
}

@test "U4: closure plan with empty/whitespace tokens within a tier skips them" {
  setup_tier_stub
  # A stray comma / whitespace token inside the tier-annotated plan must be
  # skipped exactly like the flat-CSV path (preserve trim + empty-token skip).
  run env CLOSURE_PLAN="0:svc-a,0: ,1:svc-h" bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "svc-a not attempted: $output"
  [[ "$output" == *"STUB called for: svc-h"* ]] || fail "svc-h not attempted: $output"

  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv=svc-a,svc-h"* ]] || fail "wrong succeeded_csv (whitespace token skipped): $output"
}
