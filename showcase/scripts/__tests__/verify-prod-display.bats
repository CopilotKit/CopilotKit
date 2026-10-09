#!/usr/bin/env bats
# Tests for verify-prod-display.sh — derives the verify-prod value shown in the
# promote-run Slack alert.
#
# The bug this guards (see run 27144525566 follow-up): the verify-prod job's
# empty-CSV skip branch exits 0, so the GitHub job `result` is `success` even
# though prod was NEVER probed. The notify step used to read that raw `result`
# and rendered a misleading `verify-prod=success`. The display value must
# instead distinguish:
#   * success  — prod was actually probed and passed (job result success +
#                status output "success").
#   * skipped  — nothing promoted, so prod verification was skipped (job result
#                success + status output "skipped").
#   * failure  — a real probe failure or contract violation (job result
#                failure; the status output was never written).
#   * <result> — any other job result (cancelled, etc.) passes through.
#
# NB on assertion gating: bats does NOT run test bodies under `set -e`. Only the
# FINAL command decides pass/fail, so every non-final assertion is written
# `[[ ... ]] || fail "msg"` to force a hard failure with a diagnostic.

fail() {
  echo "$1" >&2
  return 1
}

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../verify-prod-display.sh"
  [ -x "$SCRIPT" ] || fail "verify-prod-display.sh missing or not executable at $SCRIPT"
}

# run_display <PROD> <PROD_STATUS> — invoke the script with the two inputs and
# capture stdout into $output (bats convention).
run_display() {
  PROD="$1" PROD_STATUS="$2" run "$SCRIPT"
}

@test "prod probed and passed -> success" {
  run_display "success" "success"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status"
  [ "$output" = "success" ] || fail "expected 'success', got '$output'"
}

@test "nothing promoted, prod skipped -> skipped (not a misleading success)" {
  run_display "success" "skipped"
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status"
  [ "$output" = "skipped" ] || fail "expected 'skipped', got '$output'"
}

@test "real probe failure -> failure (status output never written)" {
  run_display "failure" ""
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status"
  [ "$output" = "failure" ] || fail "expected 'failure', got '$output'"
}

@test "cancelled job result passes through" {
  run_display "cancelled" ""
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status"
  [ "$output" = "cancelled" ] || fail "expected 'cancelled', got '$output'"
}

@test "skipped job result (verify-prod never ran) passes through" {
  run_display "skipped" ""
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status"
  [ "$output" = "skipped" ] || fail "expected 'skipped', got '$output'"
}

@test "defensive: job result success but status output empty -> falls back to result" {
  # If verify-prod somehow exits 0 without writing status (should not happen,
  # but be robust), do NOT fabricate a 'success'/'skipped' — surface the raw
  # job result so the signal is never invented.
  run_display "success" ""
  [ "$status" -eq 0 ] || fail "expected exit 0, got $status"
  [ "$output" = "success" ] || fail "expected fallback to 'success', got '$output'"
}
