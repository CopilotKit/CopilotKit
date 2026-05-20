#!/usr/bin/env bash
# showcase test — run probe tests against a showcase service
# Sourced by the main dispatcher; do not execute directly.

CMD_TEST_DESC="Run probe tests against a service"

usage_test() {
  cat <<'HELP'
Usage: showcase test <slug> [options]

Run probe tests against a showcase service (via Docker containers).

Options:
  --d5             Run D5 (e2e-deep) probes only
  --d4             Run D4 probes only
  --smoke          Run smoke probes only
  --verbose        Verbose test output
  --headed         Run Playwright in headed (visible) mode
  --repeat <n>     Run N times
  --keep           Don't stop auto-started packages after test
  --live           Write results to PocketBase for dashboard
  --rebuild        Force Docker rebuild before running
  --cycle          On failure, auto-dump aimock logs from the test window
  --isolate [name] Run in an isolated compose project with offset ports
                   (default name: isolate-<PID>). Allows parallel test runs.

Examples:
  showcase test mastra --d5 --verbose         # D5 probes with verbose output
  showcase test mastra --d5 --cycle           # D5 + aimock logs on failure
  showcase test langgraph-python              # all tests for a slug
  showcase test mastra --d5 --headed          # watch the browser
  showcase test agno --d5 --isolate           # isolated run (auto-named)
  showcase test agno --d5 --isolate d5verify  # isolated with explicit name
HELP
}

cmd_test() {
  local slug=""
  local cycle=""
  local isolate_name=""
  local use_isolate=false
  local harness_args=()

  # Parse arguments — pass most through to the harness CLI
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --d5)      harness_args+=(--d5);      shift ;;
      --d4)      harness_args+=(--d4);      shift ;;
      --smoke)   harness_args+=(--smoke);   shift ;;
      --verbose) harness_args+=(--verbose); shift ;;
      --headed)  harness_args+=(--headed);  shift ;;
      --keep)    harness_args+=(--keep);    shift ;;
      --live)    harness_args+=(--live);    shift ;;
      --rebuild) harness_args+=(--rebuild); shift ;;
      --cycle)   cycle=1;                   shift ;;
      --isolate)
        use_isolate=true
        shift
        # Optional name argument: consume next arg if it doesn't start with --
        # and doesn't look like a slug (no slug would be set yet if it appears
        # after --isolate, but we peek to see if it's a plain name token).
        if [[ $# -gt 0 ]] && [[ "$1" != --* ]]; then
          # If slug is already set, this is the isolate name.
          # If slug is NOT set, we need to distinguish: is this a slug or a name?
          # Convention: if slug is empty and the next arg after this one is also
          # not a flag, then this arg is the isolate name. Otherwise treat as slug.
          if [[ -n "$slug" ]]; then
            isolate_name="$1"
            shift
          else
            # Peek ahead: if there's another non-flag arg after this, this is the name
            # Otherwise this could be either — but since --isolate usually comes after
            # the slug, and the slug is still empty, this is likely the slug, not the name.
            # Leave it for the default slug handler below.
            :
          fi
        fi
        ;;
      --repeat)
        shift
        harness_args+=(--repeat "${1:?--repeat requires a value}")
        shift
        ;;
      -h|--help)
        usage_test
        return 0
        ;;
      -*)
        die "Unknown option: $1 (see 'showcase test --help')"
        ;;
      *)
        if [[ -z "$slug" ]]; then
          slug="$1"
        else
          die "Unexpected argument: $1"
        fi
        shift
        ;;
    esac
  done

  need_slug "$slug"

  # Apply isolation if requested (must happen before any compose commands).
  # Register the trap BEFORE apply_isolation so cleanup runs even if the
  # function itself crashes partway through.
  if $use_isolate; then
    trap restore_isolation EXIT
    apply_isolation "${isolate_name:-}"
  fi

  # Build the filter description for the info line
  local filter_desc=""
  for arg in "${harness_args[@]}"; do
    case "$arg" in
      --d5|--d4|--smoke) filter_desc="${filter_desc:+$filter_desc,}$arg" ;;
    esac
  done

  # If --cycle, record aimock log position before the test
  local pre_test_ts=""
  local aimock_container
  if $use_isolate && [[ -n "$ISOLATE_NAME" ]]; then
    aimock_container="${ISOLATE_NAME}-aimock"
  else
    aimock_container="showcase-aimock"
  fi
  if [[ -n "$cycle" ]]; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${aimock_container}$"; then
      pre_test_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    else
      warn "aimock container '$aimock_container' not running; --cycle log capture disabled"
    fi
  fi

  info "Testing $slug${filter_desc:+ ($filter_desc)}..."
  date -u +%Y-%m-%dT%H:%M:%SZ > "$SHOWCASE_ROOT/.last-test-ts"

  local test_exit=0
  npx tsx "$SHOWCASE_ROOT/harness/src/cli.ts" test "$slug" "${harness_args[@]}" \
    || test_exit=$?

  # --cycle: dump aimock log delta on failure
  if [[ $test_exit -ne 0 ]] && [[ -n "$cycle" ]] && [[ -n "$pre_test_ts" ]]; then
    echo ""
    echo "═══ aimock logs since test start ($pre_test_ts) ═══"
    docker logs --since "$pre_test_ts" "$aimock_container" 2>&1
    echo "═══════════════════════════════════════════════════"
  fi

  # Report result
  if [[ $test_exit -eq 0 ]]; then
    success "Tests passed for $slug"
  else
    warn "Tests failed for $slug (exit $test_exit)"
  fi

  return $test_exit
}
