#!/usr/bin/env bash
# showcase test — run probe tests against a showcase service
# Sourced by the main dispatcher; do not execute directly.

CMD_TEST_DESC="Run probe tests against a service"

usage_test() {
  cat <<'HELP'
Usage: showcase test <slug> [options]

Run probe tests against a showcase service (via Docker containers).

Options:
  --d6             Run D6 (e2e-full) probes only (via fleet control-plane)
  --d5             Run D5 (e2e-deep) probes only (via fleet control-plane)
  --d4             Run D4 probes only
  --direct         Legacy/debug: run d5/d6 via the in-process driver
                   instead of the fleet control-plane (producer->queue->worker)
  --smoke          Run smoke probes only
  --verbose        Verbose test output
  --headed         Run Playwright in headed (visible) mode
  --repeat <n>     Run N times
  --keep           Don't stop auto-started packages after test; with --isolate,
                   also leaves the isolated stack standing (teardown command
                   printed at exit). A kept stack left running with no owner is
                   auto-reaped after its keep TTL (default 4h); run
                   'showcase reap' to tear it down sooner.
  --live           Write results to PocketBase for dashboard
  --rebuild        Force Docker rebuild before running
  --cycle          On failure, auto-dump aimock logs from the test window
  --isolate [name] Run in an isolated compose project with offset ports
                   (default name: showcase-iso<slot>). Allows parallel test runs.
                   The optional name may appear before OR after the <slug>.
  --isolate=<N>    Sugar form: pin the isolation slot to N (equivalent to
                   prefixing SHOWCASE_ISO_SLOT=<N>). 1≤N≤ISOLATE_MAX_SLOT.
  --isolate=<name> Sugar form: explicit isolate name (non-numeric), equivalent
                   to '--isolate <name>'. A bare '--isolate=' is rejected.

Examples:
  showcase test mastra --d6 --verbose         # D6 probes (full matrix) with verbose output
  showcase test mastra --d5 --verbose         # D5 probes with verbose output
  showcase test mastra --d5 --cycle           # D5 + aimock logs on failure
  showcase test langgraph-python              # all tests for a slug
  showcase test mastra --d5 --headed          # watch the browser
  showcase test agno --d5 --isolate           # isolated run (auto-named)
  showcase test agno --d5 --isolate d5verify  # isolated with explicit name
  showcase test agno --d5 --isolate=9         # pin to slot 9 (equiv: SHOWCASE_ISO_SLOT=9 ... --isolate)
HELP
}

cmd_test() {
  local slug=""
  local cycle=""
  local isolate_name=""
  local use_isolate=false
  local harness_args=()
  # Pending `--isolate <token>` name candidate. The space-separated
  # `--isolate <name>` form is order-ambiguous when the slug is not yet known:
  # `--isolate mastra` could mean "isolate the slug 'mastra' (auto-named)" OR be
  # the start of "--isolate <name> <slug>". We defer the decision: stash the
  # token here, and resolve it once parsing finishes. If a positional slug also
  # appears, the stash was the explicit isolate NAME; if no slug appears, the
  # stash WAS the slug (auto-named isolation). See the post-loop resolution.
  local pending_iso_name=""
  local have_pending_iso_name=false

  # Parse arguments — pass most through to the harness CLI
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --d6)      harness_args+=(--d6);      shift ;;
      --d5)      harness_args+=(--d5);      shift ;;
      --d4)      harness_args+=(--d4);      shift ;;
      --smoke)   harness_args+=(--smoke);   shift ;;
      --verbose) harness_args+=(--verbose); shift ;;
      --headed)  harness_args+=(--headed);  shift ;;
      --keep)    ISOLATE_KEEP=true; harness_args+=(--keep); shift ;;
      --live)    harness_args+=(--live);    shift ;;
      --rebuild) harness_args+=(--rebuild); shift ;;
      --direct)  harness_args+=(--direct);  shift ;;
      --cycle)   cycle=1;                   shift ;;
      --isolate)
        use_isolate=true
        shift
        # Optional name argument: `--isolate [name]`. Consume the next token as
        # the isolate name candidate when it is a plain word (not a flag).
        #   - slug already set  → this token is unambiguously the NAME.
        #   - slug NOT set yet  → AMBIGUOUS (could be the name with a slug still
        #     to come, or the slug itself for an auto-named run). Defer via the
        #     pending-name stash; the post-loop resolution decides based on
        #     whether a positional slug also turns up.
        # A following flag (or nothing) means no explicit name → auto-named.
        if [[ $# -gt 0 ]] && [[ "$1" != --* ]]; then
          if [[ -n "$slug" ]]; then
            isolate_name="$1"
          else
            pending_iso_name="$1"
            have_pending_iso_name=true
          fi
          shift
        fi
        ;;
      --isolate=*)
        # Sugar form. Two shapes share this branch:
        #   --isolate=<N>     pins the slot by exporting SHOWCASE_ISO_SLOT; the
        #                     picker (_claim_isolate_slot in _common.sh) owns ALL
        #                     validation (positive int, 1≤N≤ISOLATE_MAX_SLOT,
        #                     slot 0 reserved, port probe).
        #   --isolate=<name>  an explicit isolate name (non-numeric), bound here.
        # A bare `--isolate=` (empty value) is rejected LOUDLY: left unguarded it
        # exports an empty SHOWCASE_ISO_SLOT that fails the picker's `-n` test and
        # silently falls through to auto-pick, bypassing the pinned-path checks.
        use_isolate=true
        local iso_val="${1#--isolate=}"
        if [[ -z "$iso_val" ]]; then
          die "--isolate= requires a value (slot number or name); got an empty value (see 'showcase test --help')"
        elif [[ "$iso_val" =~ ^[0-9]+$ ]]; then
          SHOWCASE_ISO_SLOT="$iso_val"
          export SHOWCASE_ISO_SLOT
        else
          isolate_name="$iso_val"
        fi
        shift
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

  # Resolve the deferred `--isolate <token>` name candidate now that all
  # positionals are known (see pending_iso_name above):
  #   - slug present  → the pending token was the explicit isolate NAME.
  #   - slug absent    → the pending token WAS the slug (auto-named isolation).
  # This is what lets BOTH `--isolate <name> <slug>` (name first) and the
  # auto-named `--isolate <slug>` parse correctly from the same ambiguous token.
  if $have_pending_iso_name; then
    if [[ -n "$slug" ]]; then
      isolate_name="$pending_iso_name"
    else
      slug="$pending_iso_name"
    fi
  fi

  need_slug "$slug"

  # Apply isolation if requested (must happen before any compose commands).
  # Register the trap BEFORE apply_isolation so cleanup runs even if the
  # function itself crashes partway through. restore_isolation reads the
  # ISOLATE_KEEP global (set above when --keep is parsed). It MUST be a global,
  # not a local: on the normal path cmd_test returns and its locals unwind
  # before the EXIT trap fires at top-level script exit, so a function-local
  # flag would silently read as false there (a local is only visible to the
  # trap when `die` exits from inside cmd_test itself). Under --keep,
  # restore_isolation leaves the stack standing and prints a survival notice
  # instead of tearing down, so the slot's live containers keep it from being
  # reaped.
  if $use_isolate; then
    trap restore_isolation EXIT
    apply_isolation "${isolate_name:-}" "$slug"
    if $ISOLATE_KEEP; then
      info "--keep set: isolated stack will be left standing after the run (teardown command printed at exit)"
    fi
  fi

  # Build the filter description for the info line
  local filter_desc=""
  for arg in ${harness_args[@]+"${harness_args[@]}"}; do
    case "$arg" in
      --d6|--d5|--d4|--smoke) filter_desc="${filter_desc:+$filter_desc,}$arg" ;;
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
  npx tsx "$SHOWCASE_ROOT/harness/src/cli.ts" test "$slug" ${harness_args[@]+"${harness_args[@]}"} \
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
