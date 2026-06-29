#!/usr/bin/env bats
# Tests for the alert post-and-verify predicate shared by
# .github/workflows/showcase_promote_notify.yml and its dry-run helper.
#
# The bug under test: the thread-reply and #oss-alerts cross-post used to pipe
# the Slack API response to /dev/null. Slack returns HTTP 200 with
# `{"ok":false,"error":"channel_not_found"}` on LOGICAL failures, so a failed
# failure-ALERT (the page-the-humans message) was silently dropped — no warning,
# no non-zero exit. `slack_alert_posted_ok` is the testable predicate that now
# surfaces such drops via a GitHub `::warning::` and a non-zero return.
#
# NB on assertion gating: bats does NOT run test bodies under errexit. Only the
# FINAL command's status decides pass/fail, so every non-final assertion is
# written `[[ ... ]] || fail "message"`. The `|| fail` is what forces the hard
# failure; dropping it turns the assertion into a silent false-green.

fail() {
  echo "$1" >&2
  return 1
}

setup() {
  # The predicate lives in the workflow's dry-run helper. Source it (the helper
  # has an EXECUTION GUARD so sourcing defines functions without running the
  # dry-run body).
  HELPER="$BATS_TEST_DIRNAME/../../../.github/workflows/showcase_promote_notify.dry-run.sh"
  [ -f "$HELPER" ] || fail "helper not found: $HELPER"
  # shellcheck source=/dev/null
  source "$HELPER"
}

@test "slack_alert_posted_ok: ok:true response returns 0 and emits no warning" {
  run slack_alert_posted_ok "#oss-alerts cross-post" '{"ok":true,"ts":"123.456"}'
  [ "$status" -eq 0 ] || fail "expected status 0 on ok:true, got $status"
  [[ "$output" != *"::warning::"* ]] || fail "expected NO warning on ok:true, got: $output"
}

@test "slack_alert_posted_ok: ok:false (channel_not_found) returns non-zero and warns" {
  # This is the silent-drop the fix surfaces: HTTP 200 but logical failure.
  run slack_alert_posted_ok "#oss-alerts cross-post" '{"ok":false,"error":"channel_not_found"}'
  [ "$status" -ne 0 ] || fail "expected non-zero status on ok:false, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on ok:false, got: $output"
  [[ "$output" == *"channel_not_found"* ]] || fail "expected the Slack error in the warning, got: $output"
  [[ "$output" == *"#oss-alerts cross-post"* ]] || fail "expected the call label in the warning, got: $output"
}

@test "slack_alert_posted_ok: transport-failure sentinel ({}) returns non-zero and warns" {
  # slack_api returns "{}" on non-2xx/transport failure; treat that as a drop.
  run slack_alert_posted_ok "thread reply" '{}'
  [ "$status" -ne 0 ] || fail "expected non-zero status on empty response, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on empty response, got: $output"
  [[ "$output" == *"thread reply"* ]] || fail "expected the call label in the warning, got: $output"
}

# ---------- A3: high-value predicate edge cases ----------
# Each must be treated as a DROPPED page: non-zero return AND a surfaced
# ::warning::. These exercise the `jq ... || echo false` / `// false` defenses
# against non-JSON, malformed, and ok-key-absent responses.

@test "slack_alert_posted_ok: curl transport error / non-JSON body returns non-zero and warns" {
  # slack_api feeds the raw body through on some failure modes; a proxy/5xx page
  # like '<html>500</html>' is not JSON — jq fails, `.ok` must default to false.
  run slack_alert_posted_ok "#oss-alerts cross-post" '<html>500</html>'
  [ "$status" -ne 0 ] || fail "expected non-zero status on non-JSON body, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on non-JSON body, got: $output"
  [[ "$output" == *"#oss-alerts cross-post"* ]] || fail "expected the call label in the warning, got: $output"
}

@test "slack_alert_posted_ok: malformed JSON returns non-zero and warns" {
  # A truncated/garbled body that jq cannot parse — must NOT be treated as ok.
  run slack_alert_posted_ok "#oss-alerts cross-post" '{"ok":tru'
  [ "$status" -ne 0 ] || fail "expected non-zero status on malformed JSON, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on malformed JSON, got: $output"
}

@test "slack_alert_posted_ok: missing ok key entirely ({}) returns non-zero and warns" {
  # Valid JSON but no `ok` field — `.ok // false` must default to false.
  run slack_alert_posted_ok "#oss-alerts cross-post" '{}'
  [ "$status" -ne 0 ] || fail "expected non-zero status on missing ok key, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on missing ok key, got: $output"
}

@test "slack_alert_posted_ok: ok:null returns non-zero and warns" {
  # `.ok // false` only defaults on null/absent; an explicit null must NOT pass.
  run slack_alert_posted_ok "#oss-alerts cross-post" '{"ok":null}'
  [ "$status" -ne 0 ] || fail "expected non-zero status on ok:null, got $status"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: on ok:null, got: $output"
}

# ---------- A2: anti-drift parity guard ----------
# The bats suite sources ONLY the .sh mirror, so a future yml-only edit to
# slack_alert_posted_ok would drift undetected while bats stayed green. Extract
# the function body from BOTH files and assert they are byte-identical modulo
# leading indentation (the .yml carries the step's run-block indent). Drift =>
# CI failure.

@test "slack_alert_posted_ok: yml and sh mirror definitions are identical (anti-drift)" {
  local root yml sh
  root="$BATS_TEST_DIRNAME/../../../.github/workflows"
  yml="$root/showcase_promote_notify.yml"
  sh="$root/showcase_promote_notify.dry-run.sh"
  [ -f "$yml" ] || fail "yml not found: $yml"
  [ -f "$sh" ]  || fail "sh mirror not found: $sh"

  # Extract `slack_alert_posted_ok() { ... }` (first such block) and strip
  # leading whitespace so indent differences between the two homes don't count.
  extract() {
    awk '/^[[:space:]]*slack_alert_posted_ok\(\) \{/{f=1} f{print} f&&/^[[:space:]]*\}$/{exit}' "$1" \
      | sed 's/^[[:space:]]*//'
  }
  local yml_body sh_body
  yml_body=$(extract "$yml")
  sh_body=$(extract "$sh")

  [ -n "$yml_body" ] || fail "could not extract slack_alert_posted_ok from $yml"
  [ -n "$sh_body" ]  || fail "could not extract slack_alert_posted_ok from $sh"

  [ "$yml_body" = "$sh_body" ] || fail "slack_alert_posted_ok drifted between yml and sh mirror:
$(diff <(printf '%s\n' "$sh_body") <(printf '%s\n' "$yml_body"))"
}

# ---------- A1: end-to-end call-site fail-loud/warn-only distinction ----------
# The predicate above is exercised in isolation, but the BUG the branch fixes is
# in the CALL-SITE WIRING: the #oss-alerts page-the-humans post is FAIL-LOUD (no
# `|| true`, so a dropped delivery reds the renderer job) while the thread-reply
# summary post stays WARN-ONLY (`|| true`). A future re-add of `|| true` to the
# #oss-alerts call-site would leave the predicate tests green while silently
# reintroducing the drop. These tests run the dry-run script as a subprocess on a
# FAILURE outcome (so BOTH posts execute) and inject responses via the
# DRY_RUN_OSS_RESP / DRY_RUN_THREAD_RESP hooks to lock the per-call-site exit
# semantics. The `partial` fixture yields outcome=partial → both posts fire.

PARTIAL_FIXTURE() {
  echo "$BATS_TEST_DIRNAME/../../test-fixtures/promote-notify/partial.json"
}

@test "call-site: dropped #oss-alerts page (ok:false) reds the job (non-zero exit)" {
  local fixture
  fixture="$(PARTIAL_FIXTURE)"
  [ -f "$fixture" ] || fail "partial fixture not found: $fixture"
  # OSS page drops, thread reply ok. Fail-loud call-site must propagate non-zero.
  run env DRY_RUN_OSS_RESP='{"ok":false,"error":"channel_not_found"}' \
    bash "$HELPER" --file "$fixture"
  [ "$status" -ne 0 ] || fail "expected non-zero exit when #oss-alerts page is dropped, got $status; output: $output"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: for the dropped page, got: $output"
  [[ "$output" == *"#oss-alerts cross-post"* ]] || fail "expected the #oss-alerts label in the warning, got: $output"
}

@test "call-site: dropped thread reply (ok:false) is warn-only (zero exit + warning)" {
  local fixture
  fixture="$(PARTIAL_FIXTURE)"
  [ -f "$fixture" ] || fail "partial fixture not found: $fixture"
  # Thread reply drops, OSS page ok. Warn-only call-site must NOT red the job.
  run env DRY_RUN_THREAD_RESP='{"ok":false,"error":"channel_not_found"}' \
    bash "$HELPER" --file "$fixture"
  [ "$status" -eq 0 ] || fail "expected zero exit when only the thread reply is dropped, got $status; output: $output"
  [[ "$output" == *"::warning::"* ]] || fail "expected a ::warning:: for the dropped thread reply, got: $output"
  [[ "$output" == *"thread reply"* ]] || fail "expected the thread-reply label in the warning, got: $output"
}

@test "call-site: both posts ok → zero exit, no warning" {
  local fixture
  fixture="$(PARTIAL_FIXTURE)"
  [ -f "$fixture" ] || fail "partial fixture not found: $fixture"
  # Default sim responses are ok:true for both posts.
  run bash "$HELPER" --file "$fixture"
  [ "$status" -eq 0 ] || fail "expected zero exit when both posts succeed, got $status; output: $output"
  [[ "$output" != *"::warning::"* ]] || fail "expected NO warning when both posts succeed, got: $output"
  [[ "$output" == *"outcome=partial"* ]] || fail "expected the trailing outcome line (proves the OSS post ran), got: $output"
}
