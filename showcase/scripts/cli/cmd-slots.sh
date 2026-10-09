#!/usr/bin/env bash
# showcase slots — show isolation slot status
# Sourced by the main dispatcher; do not execute directly.

CMD_SLOTS_DESC="Show isolation slot status"

usage_slots() {
  cat <<'HELP'
Usage: showcase slots [options]

Show the status of all isolation slots (0..ISOLATE_MAX_SLOT).

Options:
  --json     Emit one JSON object per slot (JSONL format)
  --free     Filter to slots that are free (unclaimed, no live pid/containers, no held ports)
  --reapable Filter to slots that are reapable (liveness == stale)
  --brief    Output only numeric slot IDs of matching slots, one per line

Flags may be combined: --free --brief      → one integer per line for each free slot
                       --free --json       → JSONL for free slots only
                       --reapable --brief  → one integer per line for each reapable slot

Notes:
  Slot 0 is reserved for the base (non-isolate) stack and is never reported as free.
  Free = dir absent + liveness not live + ports not held.
  Reapable = liveness == stale. The LIVE column reads live | kept | stale |
  inconclusive: a `kept` slot (a --keep'd stack — running containers whose
  owner is gone) is protected, NOT reapable. The PID column annotates a
  recorded owner as <pid> (alive), <pid>(reused) (pid recycled), or
  <pid>(dead) (owner gone / unverifiable).
HELP
}

cmd_slots() {
  local opt_json=false
  local opt_free=false
  local opt_reapable=false
  local opt_brief=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)     opt_json=true;     shift ;;
      --free)     opt_free=true;     shift ;;
      --reapable) opt_reapable=true; shift ;;
      --brief)    opt_brief=true;    shift ;;
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

  if $opt_free && $opt_reapable; then
    die "--free and --reapable are mutually exclusive (see 'showcase slots --help')"
  fi

  # Collect all slot records
  local -a rows=()
  local n
  for n in $(seq 0 "$ISOLATE_MAX_SLOT"); do
    rows+=("$(_slot_state "$n")")
  done

  # _row_included <slot> <dir> <liveness> <ports> — apply the active filter.
  # Returns 0 (include) when no filter is set, or when the row satisfies the
  # active --free / --reapable predicate; 1 (skip) otherwise. Slot 0 (the base
  # stack) is excluded from BOTH filters: it is never free, and never reapable.
  #   --free     = dir absent + liveness not live + ports not held
  #   --reapable = liveness == stale  (a `kept` slot is protected, NOT reapable;
  #                the kept-slot TTL is what flips an over-age kept slot to stale)
  _row_included() {
    local r_slot="$1" r_dir="$2" r_liveness="$3" r_ports="$4"
    if $opt_free; then
      [ "$r_slot" = "0" ] && return 1
      [ "$r_dir" = "absent" ] && [ "$r_liveness" != "live" ] && [ "$r_ports" != "held" ]
      return
    fi
    if $opt_reapable; then
      [ "$r_slot" = "0" ] && return 1
      [ "$r_liveness" = "stale" ]
      return
    fi
    return 0
  }

  # ── Output ────────────────────────────────────────────────────────────────

  if $opt_brief; then
    # Brief: numeric slot IDs only, one per line
    for row in "${rows[@]}"; do
      IFS='|' read -r slot dir pid liveness ports offset project <<< "$row"
      _row_included "$slot" "$dir" "$liveness" "$ports" || continue
      printf '%s\n' "$slot"
    done
    return 0
  fi

  if $opt_json; then
    # JSONL: one JSON object per slot
    for row in "${rows[@]}"; do
      IFS='|' read -r slot dir pid liveness ports offset project <<< "$row"
      _row_included "$slot" "$dir" "$liveness" "$ports" || continue
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
  # Header: SLOT(4) DIR(7) PID(11) LIVE(12) PORTS(6) OFFSET(6) PROJECT(remainder)
  # PID is 11 wide to fit the annotated forms (e.g. "79371(reused)").
  printf '%-4s  %-7s  %-11s  %-12s  %-6s  %-6s  %s\n' \
    "SLOT" "DIR" "PID" "LIVE" "PORTS" "OFFSET" "PROJECT"

  for row in "${rows[@]}"; do
    IFS='|' read -r slot dir pid liveness ports offset project <<< "$row"
    _row_included "$slot" "$dir" "$liveness" "$ports" || continue
    # Slot 0 project label
    local proj_display="$project"
    [ "$slot" = "0" ] && proj_display="showcase (base)"
    printf '%-4s  %-7s  %-11s  %-12s  %-6s  %-6s  %s\n' \
      "$slot" "$dir" "$pid" "$liveness" "$ports" "+$offset" "$proj_display"
  done

  return 0
}
