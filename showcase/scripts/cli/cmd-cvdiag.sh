#!/usr/bin/env bash
# showcase cvdiag — query, classify, replay, and purge the CVDIAG
# flap-observability event store (the `cvdiag_events` / `cvdiag_raw_byte_samples`
# PocketBase collections). Sourced by the main dispatcher; do not execute
# directly.
#
# Backed by the L2-B node entrypoints under harness/src/cvdiag/:
#   timeline  → cli-replay.ts   (ordered boundary timeline for a test-id)
#   classify  → cli-classify.ts (run the L2-A flap classifier over a test-id)
#   replay    → cli-replay.ts   (reconstruct + validate the request sequence)
#   purge     → cli-purge.ts    (cascade-delete events + raw-byte samples,
#                                then emit a cvdiag.purge_audit accounting event)
#   ab-report → cli-ab-report.ts (diff the edge vs Railway-internal A/B arms,
#                                grouped by ab_pair_id, from the collector JSON)
#
# All reads/writes go through the harness PB superuser client, which bypasses
# the three-key ACL (the writer/purge/migration role keys are write-only — see
# the cvdiag_events migration). The CLI inherits POCKETBASE_URL +
# POCKETBASE_SUPERUSER_EMAIL/PASSWORD from the environment.

CMD_CVDIAG_DESC="Query/classify/replay/purge the CVDIAG flap-observability store"

usage_cvdiag() {
  cat <<'HELP'
Usage: showcase cvdiag <subcommand> <test-id|selector>

Subcommands:
  timeline <test-id>     Print the ordered boundary timeline for a test-id.
  classify <test-id>     Run the flap classifier; print class + confidence +
                         reason + evidence as JSON. (alias: --classify)
  replay <test-id>       Reconstruct + validate the request sequence as JSON.
                         Rejects malformed stored rows with a clear error.
                         (alias: --replay)
  purge <selector>       Delete cvdiag_events matching the selector AND cascade
                         to cvdiag_raw_byte_samples, then emit a
                         cvdiag.purge_audit accounting event. The selector is a
                         test-id (UUIDv7) or a slug. (alias: --purge)
  ab-report [file]       Diff the edge vs Railway-internal A/B arms (grouped by
                         ab_pair_id) and print the report as JSON. Reads the
                         collected AbOutcomeRecord[] JSON from <file>, or from
                         stdin when no file is given. (alias: --ab-report)

Environment:
  POCKETBASE_URL                 PB base URL (required outside test/dev).
  POCKETBASE_SUPERUSER_EMAIL     Superuser identity for the CLI reads/writes.
  POCKETBASE_SUPERUSER_PASSWORD
  CVDIAG_OPERATOR_ID             Operator id stamped on the purge audit (purge).

Examples:
  showcase cvdiag timeline 0190b8a0-0000-7000-8000-000000000001
  showcase cvdiag classify 0190b8a0-0000-7000-8000-000000000001
  showcase cvdiag replay   0190b8a0-0000-7000-8000-000000000001
  showcase cvdiag purge    0190b8a0-0000-7000-8000-000000000001
  showcase cvdiag purge    langgraph-python
  showcase cvdiag ab-report ab-outcomes.json
  showcase cvdiag ab-report < ab-outcomes.json
HELP
}

# Run a cvdiag node entrypoint via tsx from the harness package. Passes the
# remaining args through verbatim. The entrypoint owns its own arg/usage checks
# and exit codes (0 ok, 1 operational error e.g. a malformed row, 2 usage).
_cvdiag_run_entrypoint() {
  local script="$1"
  shift
  local harness_dir="$SHOWCASE_ROOT/harness"
  [[ -f "$harness_dir/src/cvdiag/$script" ]] \
    || die "Missing $script — is the cvdiag CLI (L2-B) present?"
  (cd "$harness_dir" && npx tsx "src/cvdiag/$script" "$@")
}

# timeline: reconstruct the ordered sequence (cli-replay.ts) and render it as a
# compact one-line-per-boundary timeline. Falls back to the raw JSON when jq is
# unavailable so the command still works without it.
cvdiag_timeline() {
  local test_id="${1:-}"
  [[ -n "$test_id" ]] || die "test-id required (see showcase cvdiag --help)"

  local json
  if ! json="$(_cvdiag_run_entrypoint cli-replay.ts "$test_id")"; then
    die "cvdiag timeline failed for $test_id (see error above)"
  fi

  if command -v jq >/dev/null 2>&1; then
    info "Boundary timeline for $test_id"
    echo "$json" | jq -r '
      .events[]
      | "\(.ts)  [\(.layer)]  \(.boundary)  outcome=\(.outcome)"
    '
  else
    echo "$json"
  fi
}

cmd_cvdiag() {
  local subcmd="${1:-}"
  shift || true

  case "$subcmd" in
    ""|-h|--help|help)
      usage_cvdiag
      [[ -z "$subcmd" ]] && return 1
      return 0
      ;;
    timeline)
      cvdiag_timeline "$@"
      ;;
    classify|--classify)
      _cvdiag_run_entrypoint cli-classify.ts "$@"
      ;;
    replay|--replay)
      _cvdiag_run_entrypoint cli-replay.ts "$@"
      ;;
    purge|--purge)
      _cvdiag_run_entrypoint cli-purge.ts "$@"
      ;;
    ab-report|--ab-report)
      _cvdiag_run_entrypoint cli-ab-report.ts "$@"
      ;;
    *)
      die "Unknown cvdiag subcommand: $subcmd (see showcase cvdiag --help)"
      ;;
  esac
}
