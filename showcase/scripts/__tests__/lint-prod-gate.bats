#!/usr/bin/env bats
# Tests for lint-prod-gate.sh — the post-promote pinned-ness gate extracted from
# .github/workflows/showcase_promote.yml (UNIT U12, spec §8.2).
#
# Core invariant under test: after a promote, EVERY prod service must be pinned
# to an immutable `@sha256:` digest. A born-on-`:latest` service (the
# deploy-to-railway.ts unpinned-source case, spec R-E) must be caught LOUD — the
# gate exits non-zero so the verify-prod job (and the run) goes red. A
# fully-pinned fleet passes (exit 0).
#
# The gate is a thin wrapper around `bin/railway lint-prod`, whose exit-code
# contract IS the assertion: exit 1 on findings (an unpinned prod service), exit
# 0 when all pinned, exit 2 on a hard error. The real `bin/railway` is replaced
# on PATH-independent terms via RAILWAY_BIN, pointed at a stub that mimics those
# exit codes. The gate's job is to (a) invoke `lint-prod` with the right
# subcommand and (b) FAIL the step (propagate the non-zero) when lint-prod finds
# an unpinned service — never swallow it.
#
# NB on assertion gating: bats does NOT run test bodies under `set -e`. Only the
# FINAL command decides pass/fail, so every non-final assertion is written
# `[[ ... ]] || fail "msg"` to force a hard failure with a diagnostic. A bare
# `[[ ... ]]` on a non-final line is a silent no-op (false-green).

# fail <msg> — print the message to the bats failure stream and abort the test.
fail() {
  echo "$1" >&2
  return 1
}

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../lint-prod-gate.sh"
  [ -x "$SCRIPT" ] || fail "lint-prod-gate.sh missing or not executable at $SCRIPT"
  STUB_DIR="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$STUB_DIR"

  # Unpinned stub: mimics `bin/railway lint-prod` finding a born-on-:latest prod
  # service — prints a finding and exits 1 (the lint-prod findings contract).
  # Also asserts the gate invokes it with the `lint-prod` subcommand, so an
  # arg-order regression in the wrapper is caught.
  cat > "$STUB_DIR/railway-unpinned" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "lint-prod" ] || { echo "expected first arg 'lint-prod', got '$1'" >&2; exit 99; }
echo "deploy-to-railway: not digest-pinned (image=ghcr.io/copilotkit/showcase-x:latest)"
echo "DRIFT: 1 production service(s) not digest-pinned."
exit 1
STUB
  chmod +x "$STUB_DIR/railway-unpinned"

  # Pinned stub: every prod service on an @sha256: digest — exits 0.
  cat > "$STUB_DIR/railway-pinned" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "lint-prod" ] || { echo "expected first arg 'lint-prod', got '$1'" >&2; exit 99; }
echo "OK: all production services digest-pinned."
exit 0
STUB
  chmod +x "$STUB_DIR/railway-pinned"

  # Error stub: lint-prod hit a hard error (auth/GraphQL) — exits 2. The gate
  # must treat a non-zero (incl. 2) as a hard failure, never a pass.
  cat > "$STUB_DIR/railway-error" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "lint-prod" ] || { echo "expected first arg 'lint-prod', got '$1'" >&2; exit 99; }
echo "graphql error: boom" >&2
exit 2
STUB
  chmod +x "$STUB_DIR/railway-error"
}

@test "unpinned prod service -> gate fails loud (non-zero, finding surfaced)" {
  run env RAILWAY_BIN="$STUB_DIR/railway-unpinned" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on unpinned prod service, got $status"
  [[ "$output" == *"not digest-pinned"* ]] || fail "finding not surfaced: $output"
}

@test "fully-pinned fleet -> gate passes (exit 0)" {
  run env RAILWAY_BIN="$STUB_DIR/railway-pinned" bash "$SCRIPT"
  [ "$status" -eq 0 ] || fail "expected exit 0 on a fully-pinned fleet, got $status ($output)"
  [[ "$output" == *"all production services digest-pinned"* ]] || fail "OK line not surfaced: $output"
}

@test "lint-prod hard error (exit 2) -> gate fails (never swallowed)" {
  run env RAILWAY_BIN="$STUB_DIR/railway-error" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on a lint-prod hard error, got $status"
}

@test "missing/non-executable RAILWAY_BIN -> fails loud (not a vacuous pass)" {
  run env RAILWAY_BIN="$STUB_DIR/does-not-exist" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit when RAILWAY_BIN is missing, got $status"
  [[ "$output" == *"missing or not executable"* ]] || fail "missing-binary error not surfaced: $output"
}

@test "the workflow wires the gate into the verify-prod job" {
  # Guard against the gate being orphaned (script present + tested, but never
  # invoked by the promote workflow). Assert the verify-prod job actually calls
  # lint-prod-gate.sh as a post-promote step.
  WF="$BATS_TEST_DIRNAME/../../../.github/workflows/showcase_promote.yml"
  [ -f "$WF" ] || fail "promote workflow missing at $WF"
  grep -q "lint-prod-gate.sh" "$WF" || fail "showcase_promote.yml does not invoke lint-prod-gate.sh"
}
