#!/usr/bin/env bash
# showcase logs — follow container logs with optional grep filtering
# Sourced by the main dispatcher; do not execute directly.

CMD_LOGS_DESC="Follow container logs with optional filtering"

usage_logs() {
  cat <<'HELP'
Usage: showcase logs <slug> [options]

Follow container logs with optional grep filtering.

Options:
  --grep <pattern>   Filter log output (supports regex, e.g. "fixture|match")
  --since <duration> Show logs since duration (e.g. 10m, 1h, 30s)
  -n <lines>         Show last N lines (default: all)
  --no-follow        Dump logs and exit (don't follow)

Examples:
  showcase logs mastra                          # follow all logs
  showcase logs aimock --grep "fixture|match"   # filter for fixture matching
  showcase logs mastra --since 5m --no-follow   # last 5 minutes, exit
  showcase logs aimock -n 100 --grep "404"      # last 100 lines with 404s
HELP
}

cmd_logs() {
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage_logs; return 0; }
  need_slug "${1:-}"
  local slug="$1"; shift

  local container
  container="$(slug_to_container "$slug")"

  local pattern=""
  local since=""
  local tail=""
  local follow=true

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --grep)
        [[ -z "${2:-}" ]] && die "--grep requires a pattern argument"
        pattern="$2"; shift 2
        ;;
      --since)
        [[ -z "${2:-}" ]] && die "--since requires a duration argument"
        since="$2"; shift 2
        ;;
      -n)
        [[ -z "${2:-}" ]] && die "-n requires a number argument"
        tail="$2"; shift 2
        ;;
      --no-follow)
        follow=false; shift
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done

  # When --grep is used, we switch to docker logs (not compose logs)
  # to avoid noisy service-name prefixes and get full history.
  if [[ -n "$pattern" ]]; then
    _logs_with_grep "$container" "$pattern" "$since" "$tail" "$follow"
  else
    _logs_plain "$slug" "$since" "$tail" "$follow"
  fi
}

# Plain logs via docker compose (no grep filtering)
_logs_plain() {
  local slug="$1" since="$2" tail="$3" follow="$4"
  local -a args=()

  if [[ "$follow" == true ]]; then
    args+=("-f")
  fi
  if [[ -n "$since" ]]; then
    args+=("--since" "$since")
  fi
  if [[ -n "$tail" ]]; then
    args+=("--tail" "$tail")
  fi

  docker compose -f "$COMPOSE_FILE" logs "${args[@]}" "$slug"
}

# Grep-filtered logs via docker logs (direct container)
_logs_with_grep() {
  local container="$1" pattern="$2" since="$3" tail="$4" follow="$5"
  local -a args=()

  if [[ "$follow" == true ]]; then
    args+=("-f")
  fi
  if [[ -n "$since" ]]; then
    args+=("--since" "$since")
  fi
  if [[ -n "$tail" ]]; then
    args+=("--tail" "$tail")
  fi

  if [[ "$follow" == true ]]; then
    # Follow mode: --line-buffered is critical so grep flushes immediately
    docker logs "${args[@]}" "$container" 2>&1 \
      | grep --line-buffered --color=auto -E "$pattern"
  else
    docker logs "${args[@]}" "$container" 2>&1 \
      | grep --color=auto -E "$pattern"
  fi
}
