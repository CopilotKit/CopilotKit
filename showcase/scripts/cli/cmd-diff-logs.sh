#!/usr/bin/env bash
# showcase diff-logs — show log delta for a time window

CMD_DIFF_LOGS_DESC="Show log delta for a time window"

usage_diff_logs() {
  cat <<'USAGE'
Usage: showcase diff-logs <slug> --since <time> [options]

Show container logs for a specific time window. Useful when running
tests repeatedly — see only logs from the last run, not the full
container lifetime.

Options:
  --since <time>    Start of window (required). Accepts:
                      Duration: 10m, 1h, 30s
                      Timestamp: 2024-01-15T10:30:00
                      Special: "last-test" (reads .last-test-ts marker)
  --until <time>    End of window (default: now)
  --grep <pattern>  Filter output (regex, e.g. "fixture|match")

Examples:
  showcase diff-logs aimock --since 5m
  showcase diff-logs mastra --since 10m --grep "error|warn"
  showcase diff-logs aimock --since last-test
  showcase diff-logs aimock --since 10:30:00 --until 10:35:00
USAGE
}

cmd_diff_logs() {
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage_diff_logs; return 0; }

  local slug=""
  local since=""
  local until_ts=""
  local grep_pattern=""

  # First positional arg is slug, rest are flags
  slug="${1:-}"
  need_slug "$slug"
  shift

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --since)     [[ -n "${2:-}" ]] || die "--since requires a value"; since="$2"; shift 2 ;;
      --until)     [[ -n "${2:-}" ]] || die "--until requires a value"; until_ts="$2"; shift 2 ;;
      --grep)      [[ -n "${2:-}" ]] || die "--grep requires a value"; grep_pattern="$2"; shift 2 ;;
      -h|--help)   usage_diff_logs; return 0 ;;
      *)           die "Unknown option: $1" ;;
    esac
  done

  [[ -z "$since" ]] && die "--since is required"

  # Handle --since last-test convenience
  if [[ "$since" == "last-test" ]]; then
    local ts_file="$SHOWCASE_ROOT/.last-test-ts"
    if [[ -f "$ts_file" ]]; then
      since=$(cat "$ts_file")
      info "Using last test timestamp: $since"
    else
      warn "No .last-test-ts found, falling back to 5m"
      since="5m"
    fi
  fi

  local container
  container=$(slug_to_container "$slug")

  local docker_args=("--since" "$since")
  [[ -n "$until_ts" ]] && docker_args+=("--until" "$until_ts")

  local output
  if [[ -n "$grep_pattern" ]]; then
    output=$(docker logs "${docker_args[@]}" "$container" 2>&1 | grep --color=auto -E "$grep_pattern") || true
  else
    output=$(docker logs "${docker_args[@]}" "$container" 2>&1)
  fi

  local line_count
  if [[ -z "$output" ]]; then
    line_count=0
  else
    line_count=$(printf '%s\n' "$output" | wc -l | tr -d ' ')
  fi

  local window_desc="$since"
  [[ -n "$until_ts" ]] && window_desc="${since} → ${until_ts}"

  printf '═══ %s logs (%s, %d lines) ═══\n' "$container" "$window_desc" "$line_count"
  [[ -n "$output" ]] && printf '%s\n' "$output"
  echo "═══════════════════════════════════════════════════════════════"
}
