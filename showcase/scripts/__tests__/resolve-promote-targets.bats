#!/usr/bin/env bats
# Tests for resolve-promote-targets.sh — the resolve-targets logic extracted from
# .github/workflows/showcase_promote.yml so the closure derivation + the existing
# guards are unit-testable (mirrors how verify-prod-display.sh / promote-fleet.sh
# were extracted from the same workflow).
#
# U3 (spec §8.3 Phase 1, BACKWARD-COMPAT). The script MUST:
#   1. Resolve INPUT (SSOT key / dispatch_name / 'all') into services_csv —
#      the EXISTING leaf-set CSV used by the actual promote (unchanged behavior).
#   2. Compute the tiered promote CLOSURE from the generated JSON's `closure`
#      block (transitive runtimeDeps ∪ Tier-1 verification, tier-ordered 0→1→2)
#      and EMIT it into $GITHUB_STEP_SUMMARY so operators SEE the closure (§4.5),
#      WITHOUT changing the leaf-set promote (U4 enforces tier ordering later).
#   3. Emit a tier-annotated `closure_csv` output for U4 to consume.
#   4. PRESERVE the existing guards: the --digest+all reject, the empty-CSV
#      fail-loud, the ambiguous/unknown-service guard.
#
# Inputs (env): INPUT (workflow_dispatch service), DIGEST (optional), GENERATED
# (path to railway-envs.generated.json). Outputs are appended to $GITHUB_OUTPUT
# and $GITHUB_STEP_SUMMARY (both pointed at temp files by setup()).
#
# NB on assertion gating: bats does NOT run test bodies under `set -e`. Only the
# FINAL command decides pass/fail, so every non-final assertion is written
# `[[ ... ]] || fail "msg"` to force a hard failure with a diagnostic.

fail() {
  echo "$1" >&2
  return 1
}

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../resolve-promote-targets.sh"
  [ -f "$SCRIPT" ] || fail "resolve-promote-targets.sh missing at $SCRIPT"

  export GITHUB_OUTPUT="$BATS_TEST_TMPDIR/github_output"
  export GITHUB_STEP_SUMMARY="$BATS_TEST_TMPDIR/github_step_summary"
  : > "$GITHUB_OUTPUT"
  : > "$GITHUB_STEP_SUMMARY"

  # A small, self-contained fixture so the test does not depend on the live SSOT
  # (which churns as integrations come and go). Two tier-2 agents both depend on
  # tier-0 `aimock`; `dashboard` is tier-1 and depends on tier-0 `pocketbase` +
  # tier-1 `harness`. `legacy` has probe.prod:false (must never resolve as a
  # leaf). The `closure.services` array is the tier-ordered full-fleet closure
  # (as U2 emits it); the per-service entries carry promoteTier/runtimeDeps.
  GEN="$BATS_TEST_TMPDIR/generated.json"
  cat > "$GEN" <<'JSON'
{
  "closure": {
    "services": [
      { "name": "aimock", "tier": 0 },
      { "name": "pocketbase", "tier": 0 },
      { "name": "harness", "tier": 1 },
      { "name": "dashboard", "tier": 1 },
      { "name": "agent-a", "tier": 2 },
      { "name": "agent-b", "tier": 2 }
    ],
    "skipped": [
      { "name": "harness-workers", "reason": "no \"prod\" environment in the SSOT" }
    ]
  },
  "services": [
    { "name": "aimock", "dispatchName": "showcase-aimock", "probe": { "prod": true }, "promoteTier": 0 },
    { "name": "pocketbase", "dispatchName": "showcase-pocketbase", "probe": { "prod": true }, "promoteTier": 0 },
    { "name": "harness", "dispatchName": "showcase-harness", "probe": { "prod": true }, "promoteTier": 1 },
    { "name": "dashboard", "dispatchName": "shell-dashboard", "probe": { "prod": true }, "promoteTier": 1, "runtimeDeps": ["pocketbase", "harness"] },
    { "name": "agent-a", "dispatchName": "a", "probe": { "prod": true }, "promoteTier": 2, "runtimeDeps": ["aimock"], "serviceRefs": [ { "key": "OPENAI_BASE_URL", "target": "aimock" } ] },
    { "name": "agent-b", "dispatchName": "b", "probe": { "prod": true }, "promoteTier": 2, "runtimeDeps": ["aimock"] },
    { "name": "legacy", "dispatchName": "legacy", "probe": { "prod": false }, "promoteTier": 2 }
  ]
}
JSON
  export GENERATED="$GEN"
}

run_resolve() {
  # run_resolve <INPUT> [DIGEST]
  INPUT="$1" DIGEST="${2:-}" GENERATED="$GENERATED" run bash "$SCRIPT"
}

# --- existing leaf-set behavior (backward-compat, must be unchanged) ---------

@test "single service by SSOT name -> leaf services_csv is just that service" {
  run_resolve "agent-a"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^services_csv=' "$GITHUB_OUTPUT"
  [ "$output" = "services_csv=agent-a" ] || fail "leaf services_csv changed: $output"
}

@test "single service by dispatch_name -> leaf services_csv is the SSOT name" {
  run_resolve "a"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^services_csv=' "$GITHUB_OUTPUT"
  [ "$output" = "services_csv=agent-a" ] || fail "dispatch_name did not map to SSOT name: $output"
}

@test "all -> leaf services_csv is every prod-eligible service (legacy excluded)" {
  run_resolve "all"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^services_csv=' "$GITHUB_OUTPUT"
  # All prod-eligible SSOT names, sorted (the existing `sort -u` behavior).
  [ "$output" = "services_csv=agent-a,agent-b,aimock,dashboard,harness,pocketbase" ] \
    || fail "all leaf CSV wrong (legacy must be excluded): $output"
}

# --- preserved guards --------------------------------------------------------

@test "--digest + all is rejected loud" {
  run_resolve "all" "sha256:deadbeef"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on --digest+all, got $status"
  [[ "$output" == *"::error::"* ]] || fail "expected ::error:: on --digest+all: $output"
}

@test "unknown service is rejected loud" {
  run_resolve "does-not-exist"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on unknown service, got $status"
  [[ "$output" == *"::error::"* ]] || fail "expected ::error:: on unknown service: $output"
}

@test "not-prod-eligible service is rejected loud" {
  run_resolve "legacy"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on non-prod-eligible service, got $status"
  [[ "$output" == *"::error::"* ]] || fail "expected ::error:: on non-prod-eligible service: $output"
}

@test "the placeholder selection aborts loud" {
  run_resolve "__select_a_service__"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on placeholder, got $status"
  [[ "$output" == *"::error::"* ]] || fail "expected ::error:: on placeholder: $output"
}

# --- NEW: tiered closure computation + surfacing (U3) -------------------------

@test "single tier-2 service closure pulls its tier-0 dep + ALL tier-1 verification, tier-ordered" {
  run_resolve "agent-a"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^closure_csv=' "$GITHUB_OUTPUT"
  # agent-a (t2) -> aimock (t0, its runtimeDep) + harness,dashboard (t1, always
  # included for an equivalence-gated promote) + dashboard's transitive deps
  # pocketbase (t0) + harness (t1) + agent-a (t2). Tier-ordered (0→1→2), and
  # WITHIN a tier the closure block's listing order (harness BEFORE dashboard).
  [ "$output" = "closure_csv=aimock,pocketbase,harness,dashboard,agent-a" ] \
    || fail "closure_csv wrong shape/order: $output"
}

@test "closure plan is surfaced into the step summary, tier-labeled" {
  run_resolve "agent-a"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run cat "$GITHUB_STEP_SUMMARY"
  [[ "$output" == *"Promote closure"* ]] || fail "summary missing closure heading: $output"
  [[ "$output" == *"aimock"* ]] || fail "summary missing tier-0 dep aimock: $output"
  [[ "$output" == *"agent-a"* ]] || fail "summary missing requested service: $output"
  # The summary must show the TIER for each member so the operator sees ordering.
  [[ "$output" == *"tier 0"* || "$output" == *"Tier 0"* || "$output" == *"t0"* ]] \
    || fail "summary missing tier labels: $output"
}

@test "all -> closure_csv equals the full tier-ordered closure" {
  run_resolve "all"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^closure_csv=' "$GITHUB_OUTPUT"
  # The whole fleet, in the closure block's tier order (0,0,1,1,2,2).
  [ "$output" = "closure_csv=aimock,pocketbase,harness,dashboard,agent-a,agent-b" ] \
    || fail "all closure_csv wrong: $output"
}

@test "skipped (no-prod-env) members are surfaced in the summary, never silent" {
  run_resolve "all"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run cat "$GITHUB_STEP_SUMMARY"
  [[ "$output" == *"harness-workers"* ]] || fail "summary did not surface skipped member: $output"
  [[ "$output" == *"skip"* || "$output" == *"Skip"* ]] || fail "summary missing skip reason label: $output"
}

@test "tier-annotated closure_plan output is emitted for U4 to consume" {
  run_resolve "agent-a"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  # A machine-readable tier-annotated plan (tier:name pairs) for U4's gating.
  run grep '^closure_plan=' "$GITHUB_OUTPUT"
  [ "$status" -eq 0 ] || fail "closure_plan output missing"
  [[ "$output" == *"0:aimock"* ]] || fail "closure_plan missing tier-annotated tier-0 entry: $output"
  [[ "$output" == *"2:agent-a"* ]] || fail "closure_plan missing tier-annotated tier-2 entry: $output"
}

# --- NEW: standalone services (no deps, never gated) -------------------------
# A standalone leaf (e.g. `docs`) depends on nothing and gates on nothing: a
# request for ONLY standalone services must resolve to a closure of just those
# services (NO Tier-1 control plane pulled in), and each standalone member is
# emitted with the `s:` marker so the fleet driver promotes it ungated.

# Fixture variant: the normal tier-gated fleet PLUS a standalone leaf `docs`.
_gen_with_standalone() {
  cat > "$GENERATED" <<'JSON'
{
  "closure": {
    "services": [
      { "name": "aimock", "tier": 0 },
      { "name": "harness", "tier": 1 },
      { "name": "dashboard", "tier": 1 },
      { "name": "agent-a", "tier": 2 },
      { "name": "docs", "tier": 2, "standalone": true }
    ],
    "skipped": []
  },
  "services": [
    { "name": "aimock", "dispatchName": "showcase-aimock", "probe": { "prod": true }, "promoteTier": 0 },
    { "name": "harness", "dispatchName": "showcase-harness", "probe": { "prod": true }, "promoteTier": 1 },
    { "name": "dashboard", "dispatchName": "shell-dashboard", "probe": { "prod": true }, "promoteTier": 1 },
    { "name": "agent-a", "dispatchName": "a", "probe": { "prod": true }, "promoteTier": 2, "runtimeDeps": ["aimock"] },
    { "name": "docs", "dispatchName": "shell-docs", "probe": { "prod": true }, "promoteTier": 2, "standalone": true }
  ]
}
JSON
}

@test "standalone-only request resolves to a closure of JUST itself (no Tier-1 pulled in)" {
  _gen_with_standalone
  run_resolve "docs"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^closure_csv=' "$GITHUB_OUTPUT"
  [ "$output" = "closure_csv=docs" ] \
    || fail "standalone closure must be docs ONLY (no harness/dashboard): $output"
}

@test "standalone request resolves via dispatch_name (shell-docs) too" {
  _gen_with_standalone
  run_resolve "shell-docs"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^closure_csv=' "$GITHUB_OUTPUT"
  [ "$output" = "closure_csv=docs" ] \
    || fail "shell-docs must resolve to a docs-only closure: $output"
}

@test "standalone member is emitted with the s: marker in closure_plan" {
  _gen_with_standalone
  run_resolve "docs"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^closure_plan=' "$GITHUB_OUTPUT"
  [ "$output" = "closure_plan=s:docs" ] \
    || fail "standalone must emit the s:docs marker (not a numeric tier): $output"
}

@test "a normal request still pulls Tier-1 and excludes the unrelated standalone leaf" {
  _gen_with_standalone
  run_resolve "agent-a"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^closure_csv=' "$GITHUB_OUTPUT"
  [[ "$output" == *"harness"* ]] || fail "non-standalone request must still pull Tier-1 harness: $output"
  [[ "$output" != *"docs"* ]] || fail "agent-a closure must NOT include the unrelated standalone docs: $output"
}

@test "all closure_plan marks the standalone member s: and keeps the rest tier-annotated" {
  _gen_with_standalone
  run_resolve "all"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status: $output"
  run grep '^closure_plan=' "$GITHUB_OUTPUT"
  [[ "$output" == *"s:docs"* ]] || fail "all plan must mark docs standalone (s:docs): $output"
  [[ "$output" == *"1:harness"* ]] || fail "all plan must keep harness tier-annotated: $output"
}
