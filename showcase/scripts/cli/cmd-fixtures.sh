#!/usr/bin/env bash
# showcase fixtures — fixture management (validate)
# Sourced by the main dispatcher; do not execute directly.

CMD_FIXTURES_DESC="Fixture management (validate)"

usage_fixtures() {
  cat <<'HELP'
Usage: showcase fixtures <subcommand>

Subcommands:
  validate    Check fixture JSON files for common errors

Options (validate):
  --fixture-dir <path>   Directory to scan (default: showcase/aimock/)

Checks performed:
  - JSON syntax errors
  - Duplicate userMessage + turnIndex combinations
  - turnIndex sequence gaps (e.g., 0, 1, 3 — missing 2)
  - Empty or missing response fields
  - Orphaned sub-agent references (heuristic)

Examples:
  showcase fixtures validate
  showcase fixtures validate --fixture-dir /path/to/fixtures
HELP
}

cmd_fixtures() {
  local subcmd="${1:-}"
  shift || true

  case "$subcmd" in
    validate) fixtures_validate "$@" ;;
    *)        usage_fixtures; return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# fixtures_validate — run all validation checks on aimock fixture files
# ---------------------------------------------------------------------------
fixtures_validate() {
  local fixture_dir="${SHOWCASE_ROOT}/aimock"

  # Parse flags
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --fixture-dir) fixture_dir="$2"; shift 2 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  # Pre-flight: jq is required for all JSON inspection
  command -v jq >/dev/null || die "jq is required for fixture validation"

  if [[ ! -d "$fixture_dir" ]]; then
    die "Fixture directory not found: $fixture_dir"
  fi

  local files=0 fixtures=0 warnings=0

  for f in "$fixture_dir"/*.json; do
    [[ -f "$f" ]] || continue
    files=$((files + 1))

    local basename_f
    basename_f="$(basename "$f")"

    # ------------------------------------------------------------------
    # Check 1: JSON syntax
    # ------------------------------------------------------------------
    local parse_err
    if ! parse_err=$(jq empty "$f" 2>&1); then
      warn "$basename_f: invalid JSON — $parse_err"
      warnings=$((warnings + 1))
      continue
    fi

    # Count fixtures in this file (supports top-level array or .fixtures array)
    local count
    count=$(jq '
      if type == "array" then length
      elif .fixtures and (.fixtures | type) == "array" then .fixtures | length
      else 1
      end
    ' "$f")
    fixtures=$((fixtures + count))

    # Normalize: always work with the fixtures array
    local fixtures_expr
    fixtures_expr='if type == "array" then . elif .fixtures then .fixtures else [.] end'

    # ------------------------------------------------------------------
    # Check 2: Duplicate userMessage + turnIndex combos
    # ------------------------------------------------------------------
    local dupes
    dupes=$(jq -r "
      [ ${fixtures_expr} | .[]
        | select(.match.userMessage)
        | { um: .match.userMessage, ti: (.match.turnIndex // \"none\") }
      ]
      | group_by([.um, .ti])
      | map(select(length > 1))
      | .[]
      | \"  duplicate: userMessage=\\(.[0].um | tostring) turnIndex=\\(.[0].ti | tostring) (\\(length) occurrences)\"
    " "$f" 2>/dev/null || true)

    if [[ -n "$dupes" ]]; then
      warn "$basename_f: duplicate userMessage+turnIndex combinations"
      echo "$dupes"
      # Count each duplicate group as one warning
      local dupe_count
      dupe_count=$(echo "$dupes" | wc -l | tr -d ' ')
      warnings=$((warnings + dupe_count))
    fi

    # ------------------------------------------------------------------
    # Check 3: turnIndex gaps
    # ------------------------------------------------------------------
    local gaps
    gaps=$(jq -r "
      [ ${fixtures_expr} | .[]
        | select(.match.userMessage and .match.turnIndex != null)
        | { um: .match.userMessage, ti: .match.turnIndex }
      ]
      | group_by(.um)
      | .[]
      | sort_by(.ti)
      | { um: .[0].um, indices: [.[].ti] }
      | select(.indices | length > 1)
      | . as \$g
      | [range(.indices[0]; .indices[-1] + 1)]
        - .indices
      | select(length > 0) as \$missing
      | \"  gap: userMessage=\\(\$g.um) has indices \\(\$g.indices | tostring) — missing \\(\$missing | tostring)\"
    " "$f" 2>/dev/null || true)

    if [[ -n "$gaps" ]]; then
      warn "$basename_f: turnIndex sequence gaps"
      echo "$gaps"
      local gap_count
      gap_count=$(echo "$gaps" | wc -l | tr -d ' ')
      warnings=$((warnings + gap_count))
    fi

    # ------------------------------------------------------------------
    # Check 4: Empty or missing responses
    # ------------------------------------------------------------------
    local empty_resp
    empty_resp=$(jq -r "
      [ ${fixtures_expr} | to_entries[] | .key as \$idx | .value
        | select(
            (.response == null and .responses == null)
            or (.response != null and .response == {})
            or (.response != null and .response.content != null and (.response.content | length) == 0 and (.response.toolCalls == null or (.response.toolCalls | length) == 0))
            or (.responses != null and (.responses | length) == 0)
          )
        | \"  empty: fixture[\(\$idx)] \(if .match.userMessage then \"userMessage=\" + .match.userMessage else if .match.toolCallId then \"toolCallId=\" + .match.toolCallId else \"(no match key)\" end end)\"
      ] | .[]
    " "$f" 2>/dev/null || true)

    if [[ -n "$empty_resp" ]]; then
      warn "$basename_f: empty or missing response fields"
      echo "$empty_resp"
      local empty_count
      empty_count=$(echo "$empty_resp" | wc -l | tr -d ' ')
      warnings=$((warnings + empty_count))
    fi

    # ------------------------------------------------------------------
    # Check 5: Orphaned sub-agent references (heuristic)
    # ------------------------------------------------------------------
    # Find tool_calls that reference agent-like names, then check if any
    # fixture in the same file could serve as the sub-agent's response.
    # A match exists if:
    #   - a fixture has toolCallId equal to the call's id, OR
    #   - a fixture's userMessage matches the agent name, OR
    #   - a fixture's userMessage appears inside the call's arguments
    #     (sub-agents receive arguments as their prompt)
    local orphans
    orphans=$(jq -r "
      (${fixtures_expr}) as \$all |
      [ \$all[]
        | select(.response.toolCalls)
        | .response.toolCalls[]
        | select(.name | test(\"agent\"; \"i\"))
        | { name: .name, id: .id, args: (.arguments // \"\") }
      ] as \$agent_calls |
      if (\$agent_calls | length) == 0 then empty
      else
        [ \$agent_calls[]
          | . as \$call
          | select(
              [\$all[] | . as \$fix
                | select(
                    (\$fix.match.toolCallId == \$call.id)
                    or (\$fix.match.userMessage != null and (\$fix.match.userMessage | test(\$call.name; \"i\")))
                    or (\$fix.match.userMessage != null and (\$call.args | length > 0) and (\$call.args | test(\$fix.match.userMessage; \"i\")))
                  )
              ] | length == 0
            )
          | \"  orphan: tool_call id=\(.id) name=\(.name) — no matching fixture found\"
        ] | .[]
      end
    " "$f" 2>/dev/null || true)

    if [[ -n "$orphans" ]]; then
      warn "$basename_f: possible orphaned sub-agent references"
      echo "$orphans"
      local orphan_count
      orphan_count=$(echo "$orphans" | wc -l | tr -d ' ')
      warnings=$((warnings + orphan_count))
    fi

  done

  echo ""
  info "Checked $files files, $fixtures fixtures, $warnings warnings"
  if [[ $warnings -eq 0 ]]; then
    success "All fixtures valid"
  fi
}
