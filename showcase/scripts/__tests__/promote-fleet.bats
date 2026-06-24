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

# ── results JSON for the three-variant Slack renderer ───────────────────────
#
# promote-fleet emits a base64-encoded `results` blob (schema_version=1)
# consumed by .github/workflows/showcase_promote_notify.yml. The renderer is
# the SSOT for the schema; these tests assert promote-fleet emits a blob that
# matches it: valid base64 → valid JSON, schema_version=1, BOTH succeeded[] and
# failed[] present, succeeded[] entries are `{service}` objects, and failed[]
# entries are `{service, exit, category}` with the real exit code. The
# end-to-end RED-GREEN proof (decode → pipe through the dry-run harness →
# rendered ⚠️ partial / ✅ success / ❌ total message) lives outside bats.

# decode_results_b64 — read results_b64 from $GITHUB_OUTPUT and decode it to
# stdout as JSON, failing the test loudly if the key is absent or the value is
# not valid base64/JSON. Mirrors the renderer's decode step.
decode_results_b64() {
  local b64
  b64=$(grep '^results_b64=' "$GITHUB_OUTPUT" | head -1 | cut -d= -f2-)
  [ -n "$b64" ] || fail "results_b64 key absent from GITHUB_OUTPUT: $(cat "$GITHUB_OUTPUT")"
  printf '%s' "$b64" | base64 -d 2>/dev/null || fail "results_b64 is not valid base64: $b64"
}

@test "emits results JSON (schema_version=1) with both succeeded[] and failed[] on a partial promote" {
  # Mixed run: svc-a/svc-c succeed, svc-b fails (exit 7). The emitted blob must
  # carry the partial outcome the renderer turns into the ⚠️ partial message.
  run env SERVICES_CSV="svc-a,svc-b,svc-c" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on partial, got $status: $output"

  # Decode → valid JSON with schema_version=1.
  json=$(decode_results_b64)
  echo "$json" | jq -e '.schema_version == 1' >/dev/null \
    || fail "schema_version != 1: $json"

  # succeeded[] = the two that pinned, as {service} objects (renderer reads
  # length only, but we emit objects for symmetry/future use).
  [ "$(echo "$json" | jq -r '.succeeded | length')" = "2" ] \
    || fail "succeeded[] should have 2 entries: $json"
  echo "$json" | jq -e '[.succeeded[].service] | sort == ["svc-a","svc-c"]' >/dev/null \
    || fail "succeeded[] services wrong: $json"

  # failed[] = svc-b with its REAL exit code (7) + the default category. The
  # renderer renders "• `svc-b` — exit 7 (promote-failed)".
  [ "$(echo "$json" | jq -r '.failed | length')" = "1" ] \
    || fail "failed[] should have exactly 1 entry: $json"
  echo "$json" | jq -e '.failed[0] == {service:"svc-b", exit:7, category:"promote-failed"}' >/dev/null \
    || fail "failed[0] does not match {svc-b, exit 7, promote-failed}: $json"

  # The failed service must NOT leak into succeeded[].
  echo "$json" | jq -e '[.succeeded[].service] | index("svc-b") == null' >/dev/null \
    || fail "failed svc-b leaked into succeeded[]: $json"
}

@test "emits results JSON with empty failed[] on an all-green promote" {
  export RAILWAY_BIN="$STUB_DIR/railway-green"
  run env SERVICES_CSV="svc-a,svc-b,svc-c" bash "$SCRIPT"
  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"

  json=$(decode_results_b64)
  echo "$json" | jq -e '.schema_version == 1' >/dev/null || fail "schema_version != 1: $json"
  [ "$(echo "$json" | jq -r '.succeeded | length')" = "3" ] || fail "succeeded[] should have 3: $json"
  # Empty failed[] → the renderer's ✅ success variant.
  echo "$json" | jq -e '.failed == []' >/dev/null || fail "failed[] should be empty on all-green: $json"
}

@test "emits results JSON with empty succeeded[] on an all-fail promote (total variant)" {
  # Every service fails → succeeded[]=[], failed[] non-empty → the renderer's
  # ❌ total-failure variant (succeeded==0 && failed>0 defensive branch).
  run env SERVICES_CSV="svc-b" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit, got $status: $output"

  json=$(decode_results_b64)
  echo "$json" | jq -e '.schema_version == 1' >/dev/null || fail "schema_version != 1: $json"
  echo "$json" | jq -e '.succeeded == []' >/dev/null || fail "succeeded[] should be empty on all-fail: $json"
  [ "$(echo "$json" | jq -r '.failed | length')" = "1" ] || fail "failed[] should have 1: $json"
  echo "$json" | jq -e '.failed[0].exit == 7' >/dev/null || fail "failed exit code wrong: $json"
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

# ── Within-tier parallel fan-out ────────────────────────────────────────────
#
# A full `service=all` promote is dominated by bin/railway's serial
# verify_serving_digest! (~300s/service). Running every promote in a tier
# strictly one-after-another overruns the job timeout mid-fleet. promote-fleet
# now backgrounds `promote_one` WITHIN a tier up to a bounded concurrency cap
# (PROMOTE_FANOUT, default 5), drains all PIDs at the end of the tier (the tier
# BARRIER), then reaps each service's result back into the aggregate. Cross-tier
# ordering + dependent-tier gating + best-effort + the final exit-nonzero-iff-any
# -failed semantics are all preserved.
#
# These tests exercise the REAL surface: bats shells out to the real
# promote-fleet.sh with a RAILWAY_BIN stub. The tier is encoded as the FIRST
# dash-separated field of the service name (e.g. `t0-a` is a tier-0 service) so
# the stub — which only receives `promote <svc>` — can record it without the
# script forwarding the tier.
#
# DETERMINISTIC CONCURRENCY PROOF (no wall-clock-sleep race).
# An earlier version slept a fixed 0.4s in each stub invocation and asserted the
# observed peak overlap was >= 2. That is timing-fragile: on a loaded CI host a
# backgrounded promote's spawn latency can approach the sleep, so the second
# invocation starts only AFTER the first already returned — peak reads 1 and the
# test FALSE-REDs "ran serially". (We were bitten by exactly this flake.)
#
# The rewrite proves parallelism by ACTUAL SIMULTANEITY via a RENDEZVOUS BARRIER,
# independent of any sleep-vs-spawn-latency race:
#   * Each stub invocation atomically REGISTERS itself in a shared `running/`
#     directory by creating a uniquely-named file (each writes only its OWN
#     file — no shared-file append, so there is NO torn-write / atomicity risk).
#   * It then BLOCKS, polling the live count of `running/` entries, until that
#     count reaches BARRIER_TARGET (= min(cap, n_ready), the max simultaneity the
#     launcher can actually reach) OR a generous timeout elapses.
#   * While blocking it records the peak live count it ever observed to its own
#     `peak.<svc>` file, then DEREGISTERS (removes its file) and exits.
# When the launcher CAN reach the cap, exactly BARRIER_TARGET invocations are
# provably alive together (they all release only once the target is met), so the
# recorded peak == BARRIER_TARGET DETERMINISTICALLY — no dependence on sleep.
# A genuinely-serial (broken) launcher never has >1 invocation alive, so the
# barrier is never met: each invocation blocks until the TIMEOUT, then exits one
# at a time and the recorded peak stays 1 → the `peak>=cap` assertion still goes
# RED on a serial run (RED-on-serial preserved), and the timeout guarantees the
# run TERMINATES rather than deadlocking.
#
# Tests that only need start/end ORDERING (the cross-tier barrier) still record a
# per-event start/end file (one file per event — again no shared-file append) and
# read epoch.ns timestamps back from those files.

# BARRIER_TIMEOUT_SECS — generous upper bound a stub invocation waits at the
# rendezvous before giving up (so a serial launcher terminates + REDs, never
# hangs). Comfortably longer than any real launch latency; short enough that a
# broken-serial run still finishes the bats test quickly.
BARRIER_TIMEOUT_SECS=10

# setup_timeline_stub <barrier_target> [fail_svc] — install a RAILWAY_BIN that,
# for each `promote <svc>`:
#   1. writes a per-event `start.<svc>` file (epoch.ns + tier) under $EVENTS_DIR,
#   2. registers itself in $RUNNING_DIR (atomic: creates its own unique file),
#   3. blocks at the rendezvous until $RUNNING_DIR holds <barrier_target> entries
#      OR BARRIER_TIMEOUT_SECS elapses, recording the peak live count it saw to
#      $PEAKS_DIR/peak.<svc>,
#   4. deregisters, writes a per-event `end.<svc>` file, then exits 0 (or exit 7
#      if <svc> == <fail_svc>, AFTER recording everything so the failing svc is
#      still observable).
# All recording is via one-file-per-event writes (no shared-file appends), so the
# measurement is race-free. Pass barrier_target = min(PROMOTE_FANOUT, n_ready).
setup_timeline_stub() {
  local barrier_target="$1"
  local fail_svc="${2:-}"
  export EVENTS_DIR="$BATS_TEST_TMPDIR/events"
  export RUNNING_DIR="$BATS_TEST_TMPDIR/running"
  export PEAKS_DIR="$BATS_TEST_TMPDIR/peaks"
  rm -rf "$EVENTS_DIR" "$RUNNING_DIR" "$PEAKS_DIR"
  mkdir -p "$EVENTS_DIR" "$RUNNING_DIR" "$PEAKS_DIR"
  cat > "$STUB_DIR/railway-timeline" <<STUB
#!/usr/bin/env bash
[ "\$1" = "promote" ] || { echo "expected first arg 'promote', got '\$1'" >&2; exit 99; }
svc="\$2"
tier="\${svc%%-*}"   # leading t<N> field encodes the tier
echo "STUB called for: \$svc"

# (1) per-event start file (its OWN file — no shared append).
printf '%s %s\n' "\$(date +%s.%N)" "\$tier" > "$EVENTS_DIR/start.\$svc"

# (2) register at the rendezvous: create our own unique membership file.
printf '%s' "\$\$" > "$RUNNING_DIR/\$svc"

# (3) block until BARRIER_TARGET are simultaneously alive OR timeout; track the
#     peak live count we observe. Count = number of membership files in
#     \$RUNNING_DIR, computed by globbing into the positional params (no \`ls\`
#     parsing — robust + shellcheck-clean) and reading \$#.
target=$barrier_target
deadline=\$(( \$(date +%s) + $BARRIER_TIMEOUT_SECS ))
peak=0
while :; do
  set -- "$RUNNING_DIR"/*
  if [ "\$1" = "$RUNNING_DIR/*" ] && [ ! -e "\$1" ]; then
    live=0   # glob did not match (empty dir)
  else
    live=\$#
  fi
  [ "\$live" -gt "\$peak" ] && peak=\$live
  [ "\$live" -ge "\$target" ] && break
  [ "\$(date +%s)" -ge "\$deadline" ] && break
  sleep 0.02
done
printf '%s' "\$peak" > "$PEAKS_DIR/peak.\$svc"

# (4) deregister, record end, exit.
rm -f "$RUNNING_DIR/\$svc"
printf '%s %s\n' "\$(date +%s.%N)" "\$tier" > "$EVENTS_DIR/end.\$svc"
if [ "\$svc" = "$fail_svc" ]; then exit 7; fi
exit 0
STUB
  chmod +x "$STUB_DIR/railway-timeline"
  export RAILWAY_BIN="$STUB_DIR/railway-timeline"
}

# max_concurrency — print the peak number of simultaneously-alive stub
# invocations, read DETERMINISTICALLY from the per-invocation peak files the
# rendezvous barrier recorded (each invocation logged the max live count it ever
# saw). The fleet-wide peak is the max across those readings. No timestamp
# sweep, no sleep dependence: when the launcher reaches the cap, every concurrent
# invocation observes (and records) that count before any releases.
max_concurrency() {
  local p max=0
  for f in "$PEAKS_DIR"/peak.*; do
    [ -f "$f" ] || continue
    p="$(cat "$f")"
    [ "$p" -gt "$max" ] && max="$p"
  done
  printf '%s' "$max"
}

@test "fan-out: within a tier, promotes run concurrently but never exceed PROMOTE_FANOUT" {
  # 6 tier-0 services, cap 3. The rendezvous barrier makes the proof
  # deterministic: with cap 3 and 6 ready, exactly 3 promotes are provably alive
  # together (they only release once 3 have rendezvoused), so the recorded peak
  # is EXACTLY 3 — independent of any sleep. peak must REACH the cap (proves
  # parallelism, not still-serial) and never EXCEED it (proves the bound holds).
  setup_timeline_stub 3   # BARRIER_TARGET = min(PROMOTE_FANOUT=3, ready=6) = 3
  run env PROMOTE_FANOUT=3 \
    CLOSURE_PLAN="0:t0-a,0:t0-b,0:t0-c,0:t0-d,0:t0-e,0:t0-f" \
    bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit on all-green fan-out, got $status: $output"
  # Every service attempted.
  for s in t0-a t0-b t0-c t0-d t0-e t0-f; do
    [[ "$output" == *"STUB called for: $s"* ]] || fail "$s not attempted: $output"
  done

  local peak
  peak="$(max_concurrency)"
  # Bound enforced: never more than PROMOTE_FANOUT in flight at once.
  [ "$peak" -le 3 ] || fail "peak concurrency $peak exceeded PROMOTE_FANOUT=3 (peaks: $(cat "$PEAKS_DIR"/peak.* 2>/dev/null))"
  # Parallelism actually happened. With the barrier this is deterministic: a
  # still-serial launcher never gets >1 invocation alive, never meets the
  # rendezvous, and each invocation times out with a recorded peak of 1 — so this
  # assertion goes RED on a serial run (RED-on-serial preserved) with no flake.
  [ "$peak" -ge 2 ] || fail "peak concurrency $peak < 2 — promotes ran serially, not in parallel (peaks: $(cat "$PEAKS_DIR"/peak.* 2>/dev/null))"
}

@test "fan-out: tier barrier — no tier-1 start precedes any tier-0 end" {
  # Cross-tier MUST stay strictly serial: the tier-0 drain (barrier) completes
  # before any tier-1 promote launches. A naive fan-out that backgrounds across
  # tier boundaries would let a tier-1 start race ahead of a tier-0 end — this
  # asserts it does not. BARRIER_TARGET=2 is reachable WITHIN each tier (tier-0
  # has 3 ready, tier-1 has 2), so neither tier deadlocks; the rendezvous holds
  # each tier's promotes alive together long enough that a cross-tier leak (a
  # tier-1 start before a tier-0 end) would be plainly visible in the ordering.
  setup_timeline_stub 2
  run env PROMOTE_FANOUT=5 \
    CLOSURE_PLAN="0:t0-a,0:t0-b,0:t0-c,1:t1-g,1:t1-h" \
    bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"

  # Latest tier-0 `end` timestamp (from per-event end.<svc> files; field 2 is the
  # tier, field 1 is the epoch.ns).
  local last_t0_end
  last_t0_end="$(cat "$EVENTS_DIR"/end.t0-* 2>/dev/null | awk '{ print $1 }' | sort -g | tail -1)"
  # Earliest tier-1 `start` timestamp.
  local first_t1_start
  first_t1_start="$(cat "$EVENTS_DIR"/start.t1-* 2>/dev/null | awk '{ print $1 }' | sort -g | head -1)"

  [ -n "$last_t0_end" ] || fail "no tier-0 end markers: $(ls "$EVENTS_DIR")"
  [ -n "$first_t1_start" ] || fail "no tier-1 start markers: $(ls "$EVENTS_DIR")"

  # Barrier: every tier-1 start happens at or after the last tier-0 end.
  # awk numeric compare (timestamps are epoch.ns floats). Boundary-inclusive
  # (>=): a tier-1 start tying the last tier-0 end on a coarse clock is valid;
  # only a start STRICTLY before a tier-0 end (b < a) is a real violation.
  awk -v a="$last_t0_end" -v b="$first_t1_start" 'BEGIN { exit !(b >= a) }' \
    || fail "tier barrier violated: tier-1 start $first_t1_start did not follow tier-0 end $last_t0_end (events: $(ls "$EVENTS_DIR"))"
}

@test "fan-out: a failing tier-0 svc does not abort its siblings; run exits nonzero and reports the failure" {
  # Best-effort within the (parallel) tier must survive: when one tier-0 service
  # exits 7, every OTHER tier-0 service still launches + runs to completion, the
  # final exit is nonzero, and the summary lists the failed svc as `<svc>=7`.
  # The failing svc records its start/barrier/end markers BEFORE exiting 7, so it
  # still participates in the rendezvous (BARRIER_TARGET=4 = min(cap 5, ready 4)).
  setup_timeline_stub 4 "t0-b"
  run env PROMOTE_FANOUT=5 \
    CLOSURE_PLAN="0:t0-a,0:t0-b,0:t0-c,0:t0-d" \
    bash "$SCRIPT"

  # All four tier-0 services launched despite t0-b failing.
  for s in t0-a t0-b t0-c t0-d; do
    [[ "$output" == *"STUB called for: $s"* ]] || fail "$s not attempted (best-effort broken): $output"
    [ -f "$EVENTS_DIR/start.$s" ] || fail "$s has no start marker (did not actually launch): $(ls "$EVENTS_DIR")"
  done

  # Non-zero aggregate exit because t0-b failed.
  [ "$status" -ne 0 ] || fail "expected non-zero exit on a failed svc, got $status: $output"
  # Summary classifies t0-b as failed with its exit code.
  [[ "$output" == *"t0-b=7"* ]] || fail "failed svc t0-b=7 not reported in summary: $output"
  # The greens are reported succeeded.
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"succeeded_csv="* ]] || fail "missing succeeded_csv: $output"
  [[ "$output" == *"t0-a"* && "$output" == *"t0-c"* && "$output" == *"t0-d"* ]] \
    || fail "green siblings missing from succeeded_csv: $output"
  [[ "$output" != *"t0-b"* ]] || fail "failed t0-b leaked into succeeded_csv: $output"
}

@test "fan-out: PROMOTE_FANOUT override is honored (cap 2 holds peak <= 2)" {
  # Lowering the cap to 2 must hold the peak concurrency to 2 even with 6 ready
  # services — proves the env override actually drives the launcher bound. With
  # BARRIER_TARGET=2 the rendezvous deterministically reaches exactly 2 (if the
  # launcher honors the override); if it ignored the cap and ran all 6, peak
  # would exceed 2; if it ran serially, peak would stay 1 and the >=2 assertion
  # REDs. Either way the override is proven without any sleep dependence.
  setup_timeline_stub 2   # BARRIER_TARGET = min(PROMOTE_FANOUT=2, ready=6) = 2
  run env PROMOTE_FANOUT=2 \
    CLOSURE_PLAN="0:t0-a,0:t0-b,0:t0-c,0:t0-d,0:t0-e,0:t0-f" \
    bash "$SCRIPT"

  [ "$status" -eq 0 ] || fail "expected zero exit, got $status: $output"
  local peak
  peak="$(max_concurrency)"
  [ "$peak" -le 2 ] || fail "PROMOTE_FANOUT=2 not honored: peak concurrency $peak > 2 (peaks: $(cat "$PEAKS_DIR"/peak.* 2>/dev/null))"
  [ "$peak" -ge 2 ] || fail "cap-2 run never reached concurrency 2 — not parallel (peaks: $(cat "$PEAKS_DIR"/peak.* 2>/dev/null))"
}

@test "fan-out: a PRESENT-but-EMPTY .rc (crash/disk-full mid-write) is treated as failed, not parsed as garbage" {
  # The backgrounded promote_one subshell can be killed (or the disk fill) AFTER
  # its <slot>.rc file exists but BEFORE the exit code is written — leaving a
  # PRESENT-but-EMPTY .rc. reap_tier's `-f` check passes (the file exists), so the
  # missing-file guard does NOT fire; if reap_tier then trusts the empty contents,
  # `[ "$rc" -eq 0 ]` runs on rc="" and bash errors with "integer expression
  # expected", and the svc gets recorded as a garbage `<svc>=` (empty rc). This
  # asserts the empty/non-numeric rc is validated and folded as a real failure.
  #
  # We drive it with a stub that locates the script's scratch dir, pre-writes an
  # EMPTY <svc>.rc, then kill -9's its parent (the promote_one subshell) so the
  # script never overwrites the empty .rc with a real exit code.
  cat > "$STUB_DIR/railway-emptyrc" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "promote" ] || { echo "expected first arg 'promote', got '$1'" >&2; exit 99; }
svc="$2"
echo "STUB called for: $svc"
# Locate promote_one's scratch dir (the sole promote-fleet.* under TMPDIR) and
# pre-seed an EMPTY .rc for this service, mimicking a write that began but never
# completed (crash/disk-full). svc names here carry no '/', so the slot == svc.
work="$(ls -d "${TMPDIR:-/tmp}"/promote-fleet.* 2>/dev/null | tail -1)"
if [ -n "$work" ] && [ -d "$work" ]; then
  : > "$work/$svc.rc"
fi
# Kill the promote_one subshell so it dies BEFORE writing the real rc, leaving
# the present-but-empty .rc behind. The stub runs inside promote_one's command
# substitution: $PPID is that cmd-subst subshell; its parent (grandparent of the
# stub) is the backgrounded promote_one subshell itself — kill THAT so line 179's
# `echo "$rc" > <slot>.rc` never overwrites the empty file. -9 so no trap rewrites it.
gp="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
[ -n "$gp" ] && kill -9 "$gp" 2>/dev/null
kill -9 "$PPID" 2>/dev/null
exit 0
STUB
  chmod +x "$STUB_DIR/railway-emptyrc"
  export RAILWAY_BIN="$STUB_DIR/railway-emptyrc"

  run env SERVICES_CSV="svc-empty" bash "$SCRIPT"

  # (1) the run exits NONZERO — a lost/garbled result must never read as success.
  [ "$status" -ne 0 ] || fail "expected non-zero exit on empty .rc, got $status: $output"

  # (2) the bash `[` integer-comparison error must NOT leak (the symptom of an
  #     unvalidated empty rc reaching `[ "$rc" -eq 0 ]`).
  [[ "$output" != *"integer expression expected"* ]] \
    || fail "empty rc leaked into integer comparison: $output"

  # (3) the service is recorded as a real failure (rc coerced to 1), NOT a garbage
  #     empty `svc-empty=` entry.
  [[ "$output" == *"svc-empty=1"* ]] || fail "empty-rc svc not recorded as svc-empty=1: $output"
  [[ "$output" != *"svc-empty= "* && "$output" != *"svc-empty="$'\n'* ]] \
    || fail "garbage empty-rc entry (svc-empty=) leaked into summary: $output"
}

# --- NEW: standalone services (`s:` tier marker) -----------------------------
# A standalone service is promoted UNGATED: it is attempted regardless of any
# other service's failure (never NOT-ATTEMPTED on an unrelated failure), and its
# own failure fails the run WITHOUT gating the tiered services.

@test "U4: a standalone (s:) service is promoted even when an unrelated tier-1 service fails" {
  setup_tier_stub
  # tier-1 svc-fail fails (gating tier-2 svc-i1 as usual). The standalone
  # svc-docs (s:) must STILL be attempted and must land in succeeded_csv.
  run env CLOSURE_PLAN="s:svc-docs,0:svc-a,1:svc-fail,2:svc-i1" bash "$SCRIPT"

  # Standalone attempted DESPITE the unrelated tier-1 failure.
  [[ "$output" == *"STUB called for: svc-docs"* ]] \
    || fail "standalone svc-docs must be attempted despite the tier-1 failure: $output"
  # Normal tier gating is unchanged: tier-2 svc-i1 is still gated.
  [[ "$output" != *"STUB called for: svc-i1"* ]] \
    || fail "tier-2 svc-i1 should still be gated by the tier-1 failure: $output"
  # The run still fails (svc-fail genuinely failed)...
  [ "$status" -ne 0 ] || fail "expected non-zero exit (svc-fail failed), got $status: $output"
  # ...but the standalone promoted successfully and is NOT in NOT-ATTEMPTED.
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"svc-docs"* ]] || fail "standalone svc-docs should be in succeeded_csv: $output"
}

@test "U4: a standalone (s:) service's OWN failure fails the run but does NOT gate the tiers" {
  setup_tier_stub
  # The standalone svc-fail fails. Because a standalone neither gates nor is
  # gated, EVERY tier must still be attempted, and the run exits non-zero.
  run env CLOSURE_PLAN="s:svc-fail,0:svc-a,1:svc-h,2:svc-i1" bash "$SCRIPT"

  [[ "$output" == *"STUB called for: svc-fail"* ]] || fail "standalone svc-fail not attempted: $output"
  # All tiers STILL attempted — the standalone failure must not gate them.
  [[ "$output" == *"STUB called for: svc-a"* ]] || fail "tier-0 svc-a gated by standalone failure: $output"
  [[ "$output" == *"STUB called for: svc-h"* ]] || fail "tier-1 svc-h gated by standalone failure: $output"
  [[ "$output" == *"STUB called for: svc-i1"* ]] || fail "tier-2 svc-i1 gated by standalone failure: $output"
  [ "$status" -ne 0 ] || fail "expected non-zero exit (standalone svc-fail failed), got $status: $output"
  # The tiered services were NOT recorded NOT-ATTEMPTED.
  [[ "$output" != *"NOT-ATTEMPTED"* ]] || fail "a standalone failure must not gate (NOT-ATTEMPTED) any tier: $output"
}

@test "U4: an all-green plan with a standalone (s:) member promotes everything" {
  setup_tier_stub
  run env CLOSURE_PLAN="s:svc-docs,0:svc-a,1:svc-h,2:svc-i1" bash "$SCRIPT"
  [ "$status" -eq 0 ] || fail "expected exit 0 for an all-green plan, got $status: $output"
  for s in svc-docs svc-a svc-h svc-i1; do
    [[ "$output" == *"STUB called for: $s"* ]] || fail "$s not attempted: $output"
  done
  run cat "$GITHUB_OUTPUT"
  [[ "$output" == *"svc-docs"* ]] || fail "standalone svc-docs should be in succeeded_csv: $output"
}
