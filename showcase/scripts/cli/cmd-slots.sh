#!/usr/bin/env bash
# showcase slots — show isolation slot status
# Sourced by the main dispatcher; do not execute directly.

CMD_SLOTS_DESC="Show isolation slot status"

usage_slots() {
  cat <<'HELP'
Usage: showcase slots [options]

Show the status of all isolation slots (0..ISOLATE_MAX_SLOT).

Options:
  --json    Emit one JSON object per slot (JSONL format)
  --free    Filter to slots that are free (unclaimed, no live pid/containers, no held ports)
  --brief   Output only numeric slot IDs of matching slots, one per line

Flags may be combined: --free --brief  → one integer per line for each free slot
                       --free --json   → JSONL for free slots only

Notes:
  Slot 0 is reserved for the base (non-isolate) stack and is never reported as free.
  Free = dir absent + liveness not live + ports not held.
HELP
}

cmd_slots() {
  local opt_json=false
  local opt_free=false
  local opt_brief=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)   opt_json=true;   shift ;;
      --free)   opt_free=true;   shift ;;
      --brief)  opt_brief=true;  shift ;;
      -h|--help)
        usage_slots
        return 0
        ;;
      -*)
        die "Unknown flag: $1 (see 'showcase slots --help')"
        ;;
      *)
        die "Unexpected argument: $1 (see 'showcase slots --help')"
        ;;
    esac
  done

  # Collect all slot records
  local -a rows=()
  local n
  for n in $(seq 0 "$ISOLATE_MAX_SLOT"); do
    rows+=("$(_slot_state "$n")")
  done

  # ── Output ────────────────────────────────────────────────────────────────

  if $opt_brief; then
    # Brief: numeric slot IDs only, one per line
    for row in "${rows[@]}"; do
      IFS='|' read -r slot dir pid liveness ports offset project <<< "$row"
      # Slot 0 is never free (reserved for base stack)
      if $opt_free; then
        [ "$slot" = "0" ] && continue
        # Free = dir absent, liveness not live, ports not held
        [ "$dir" = "absent" ] && [ "$liveness" != "live" ] && [ "$ports" != "held" ] || continue
      fi
      printf '%s\n' "$slot"
    done
    return 0
  fi

  if $opt_json; then
    # JSONL: one JSON object per slot
    for row in "${rows[@]}"; do
      IFS='|' read -r slot dir pid liveness ports offset project <<< "$row"
      if $opt_free; then
        [ "$slot" = "0" ] && continue
        [ "$dir" = "absent" ] && [ "$liveness" != "live" ] && [ "$ports" != "held" ] || continue
      fi
      # Slot 0 project label
      local proj_display="$project"
      [ "$slot" = "0" ] && proj_display="showcase (base)"
      jq -nc \
        --argjson slot    "$slot" \
        --arg     dir     "$dir" \
        --arg     pid     "$pid" \
        --arg     liveness "$liveness" \
        --arg     ports   "$ports" \
        --argjson offset  "$offset" \
        --arg     project "$proj_display" \
        '{slot: $slot, dir: $dir, pid: $pid, liveness: $liveness, ports: $ports, offset: $offset, project: $project}'
    done
    return 0
  fi

  # Default: fixed-width table
  # Header: SLOT(4) DIR(7) PID(6) LIVE(12) PORTS(6) OFFSET(6) PROJECT(remainder)
  printf '%-4s  %-7s  %-6s  %-12s  %-6s  %-6s  %s\n' \
    "SLOT" "DIR" "PID" "LIVE" "PORTS" "OFFSET" "PROJECT"

  for row in "${rows[@]}"; do
    IFS='|' read -r slot dir pid liveness ports offset project <<< "$row"
    if $opt_free; then
      [ "$slot" = "0" ] && continue
      [ "$dir" = "absent" ] && [ "$liveness" != "live" ] && [ "$ports" != "held" ] || continue
    fi
    # Slot 0 project label
    local proj_display="$project"
    [ "$slot" = "0" ] && proj_display="showcase (base)"
    printf '%-4s  %-7s  %-6s  %-12s  %-6s  %-6s  %s\n' \
      "$slot" "$dir" "$pid" "$liveness" "$ports" "+$offset" "$proj_display"
  done

  return 0
}
