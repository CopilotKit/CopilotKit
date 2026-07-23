#!/usr/bin/env bats
# Tests for reconcile-prod-gate.sh — the on-demand prod-vs-staging drift gate.
#
# Core invariant under test: a STALE prod service (its serving digest has
# drifted BEHIND a green staging) must be caught LOUD — the gate exits non-zero
# so a manual run visibly flags the drift on the run. A fleet with no stale
# service passes (exit 0); a hard error (exit 2) is never swallowed.
#
# The gate is a thin wrapper around `bin/railway reconcile-prod`, whose
# exit-code contract IS the assertion: exit 1 on a stale service, exit 0 when
# none stale (all green, or only green+gray), exit 2 on a hard error. The real
# `bin/railway` is replaced via RAILWAY_BIN, pointed at a stub mimicking those
# exit codes. The gate's job is to (a) invoke `reconcile-prod` with the right
# subcommand and (b) FAIL the step (propagate the non-zero) on a stale service
# — never swallow it.
#
# NB on assertion gating: bats does NOT run test bodies under `set -e`. Only the
# FINAL command decides pass/fail, so every non-final assertion is written
# `[[ ... ]] || fail "msg"` to force a hard failure with a diagnostic.

# fail <msg> — print the message to the bats failure stream and abort the test.
fail() {
  echo "$1" >&2
  return 1
}

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../reconcile-prod-gate.sh"
  [ -x "$SCRIPT" ] || fail "reconcile-prod-gate.sh missing or not executable at $SCRIPT"
  STUB_DIR="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$STUB_DIR"

  # Stale stub: mimics `bin/railway reconcile-prod` finding a prod service that
  # has drifted behind a green staging — prints a table + STALE line and exits
  # 1 (the reconcile-prod findings contract). Also asserts the gate invokes it
  # with the `reconcile-prod` subcommand, so an arg-order regression is caught.
  cat > "$STUB_DIR/railway-stale" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "reconcile-prod" ] || { echo "expected first arg 'reconcile-prod', got '$1'" >&2; exit 99; }
echo "NAME   STATUS  PROD          STAGING"
echo "shell  stale   aaaa1111      bbbb2222"
echo ""
echo "Summary: 0 green, 1 stale, 0 gray (1 prod-eligible)."
echo "STALE: prod has drifted behind green staging for: shell."
exit 1
STUB
  chmod +x "$STUB_DIR/railway-stale"

  # In-sync stub: no service stale — exits 0.
  cat > "$STUB_DIR/railway-green" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "reconcile-prod" ] || { echo "expected first arg 'reconcile-prod', got '$1'" >&2; exit 99; }
echo "Summary: 39 green, 0 stale, 0 gray (39 prod-eligible)."
echo "OK: no production service is stale vs staging."
exit 0
STUB
  chmod +x "$STUB_DIR/railway-green"

  # Error stub: reconcile-prod hit a hard error (auth/GraphQL) — exits 2. The
  # gate must treat a non-zero (incl. 2) as a hard failure, never a pass.
  cat > "$STUB_DIR/railway-error" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "reconcile-prod" ] || { echo "expected first arg 'reconcile-prod', got '$1'" >&2; exit 99; }
echo "graphql error: boom" >&2
exit 2
STUB
  chmod +x "$STUB_DIR/railway-error"

  # JSON-error stub: distinguishes the machine-output (`--json`) invocation from
  # the human-table invocation. The `--json` invocation emits a DISTINCT stderr
  # diagnostic (`JSON-CAPTURE-DIAG`) and NO stdout payload, then exits 2; the
  # human-table invocation emits its own line. This isolates the `--json`
  # capture path so we can assert it (a) preserves ITS stderr diagnostic instead
  # of routing it to /dev/null and (b) does not write a blank artifact from the
  # empty stdout.
  cat > "$STUB_DIR/railway-json-error" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "reconcile-prod" ] || { echo "expected first arg 'reconcile-prod', got '$1'" >&2; exit 99; }
if [ "$2" = "--json" ]; then
  echo "graphql error: JSON-CAPTURE-DIAG staging outage" >&2
  exit 2
fi
echo "graphql error: human-table boom" >&2
exit 2
STUB
  chmod +x "$STUB_DIR/railway-json-error"
}

@test "stale prod service -> gate fails loud (non-zero, finding surfaced)" {
  run env RAILWAY_BIN="$STUB_DIR/railway-stale" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on a stale prod service, got $status"
  [[ "$output" == *"STALE"* ]] || fail "stale finding not surfaced: $output"
  [[ "$output" == *"shell"* ]] || fail "stale service name not surfaced: $output"
}

@test "no stale service -> gate passes (exit 0)" {
  run env RAILWAY_BIN="$STUB_DIR/railway-green" bash "$SCRIPT"
  [ "$status" -eq 0 ] || fail "expected exit 0 when no service stale, got $status ($output)"
  [[ "$output" == *"no production service has drifted stale"* ]] || fail "OK line not surfaced: $output"
}

@test "reconcile-prod hard error (exit 2) -> gate fails (never swallowed)" {
  run env RAILWAY_BIN="$STUB_DIR/railway-error" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit on a reconcile-prod hard error, got $status"
}

@test "missing/non-executable RAILWAY_BIN -> fails loud (not a vacuous pass)" {
  run env RAILWAY_BIN="$STUB_DIR/does-not-exist" bash "$SCRIPT"
  [ "$status" -ne 0 ] || fail "expected non-zero exit when RAILWAY_BIN is missing, got $status"
  [[ "$output" == *"missing or not executable"* ]] || fail "missing-binary error not surfaced: $output"
}

@test "RECONCILE_JSON writes machine output without changing the verdict" {
  # The JSON capture is a best-effort SECOND invocation; its presence must not
  # change the gate verdict. With the green stub the gate still exits 0, and
  # the JSON file is created from the stub's stdout.
  JSON_OUT="$BATS_TEST_TMPDIR/reconcile.json"
  run env RAILWAY_BIN="$STUB_DIR/railway-green" RECONCILE_JSON="$JSON_OUT" bash "$SCRIPT"
  [ "$status" -eq 0 ] || fail "expected exit 0 with green stub + RECONCILE_JSON, got $status ($output)"
  [ -f "$JSON_OUT" ] || fail "RECONCILE_JSON file not written"
}

@test "RECONCILE_JSON capture preserves the stderr diagnostic on a hard error" {
  # When the --json capture invocation hits a hard error, its stderr diagnostic
  # must NOT be swallowed (routed to /dev/null) — a failed probe has to leave a
  # diagnostic trail in the job log instead of vanishing.
  JSON_OUT="$BATS_TEST_TMPDIR/reconcile.json"
  run env RAILWAY_BIN="$STUB_DIR/railway-json-error" RECONCILE_JSON="$JSON_OUT" bash "$SCRIPT"
  [[ "$output" == *"JSON-CAPTURE-DIAG"* ]] || fail "stderr diagnostic from the --json capture was swallowed: $output"
}

@test "RECONCILE_JSON does not write a blank artifact when the capture produces nothing" {
  # When the --json invocation errors and emits no payload, the gate must NOT
  # leave a blank/empty reconcile.json behind — an empty artifact is uploaded as
  # if it were a real result. Either no file, or a non-empty file.
  JSON_OUT="$BATS_TEST_TMPDIR/reconcile.json"
  run env RAILWAY_BIN="$STUB_DIR/railway-json-error" RECONCILE_JSON="$JSON_OUT" bash "$SCRIPT"
  if [ -f "$JSON_OUT" ]; then
    [ -s "$JSON_OUT" ] || fail "wrote a blank reconcile.json artifact (empty file) on a no-payload error"
  fi
}

@test "the on-demand workflow wires the gate in" {
  # Guard against the gate being orphaned (script present + tested, but never
  # invoked by the reconcile workflow). Assert the workflow actually calls
  # reconcile-prod-gate.sh.
  WF="$BATS_TEST_DIRNAME/../../../.github/workflows/showcase_reconcile.yml"
  [ -f "$WF" ] || fail "reconcile workflow missing at $WF"
  grep -q "reconcile-prod-gate.sh" "$WF" || fail "showcase_reconcile.yml does not invoke reconcile-prod-gate.sh"
}
