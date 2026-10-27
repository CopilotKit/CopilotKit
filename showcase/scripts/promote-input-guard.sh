# shellcheck shell=bash
# promote-input-guard.sh — the ONE input-validation guard for every promote
# entrypoint that takes service names or a digest from a human or from another
# job (resolve-promote-targets.sh, promote-fleet.sh). Sourced, not executed.
#
# Why one guard: each value ends up as an argv element of `bin/railway promote`.
# A token such as `--yes` is parsed by the CLI's OptionParser as a FLAG, the
# positional service disappears, and the CLI promotes the WHOLE fleet —
# including services the operator held. Partial parsing (`IFS=, read` stops at
# the first LF) silently drops tokens. So every value is validated WHOLE,
# before it is split, and the caller fails closed before any CLI call.
#
# Rules for a service-name CSV:
#   * only the characters a-z 0-9 - and the comma separator (no CR, LF, tab,
#     space, upper case, or anything else; the set is spelled out so locale
#     collation cannot widen it);
#   * no empty token (no leading, trailing or doubled comma);
#   * no token starting with `-` (it would be read as a CLI option);
#   * every token is a known SSOT name (from railway-envs.generated.json).
# Rules for a digest ref: only A-Z a-z 0-9 . _ / : @ -, not starting with `-`.
#
# Every guard prints a `::error::` line to stderr and returns 1 on rejection.
# Callers do `guard_... || exit 1`.

PROMOTE_GUARD_NAME_CHARS='abcdefghijklmnopqrstuvwxyz0123456789-'

# guard_ssot_names <generated.json> <name|name_or_dispatch>
# Prints the accepted SSOT names, one per line. `name` = .services[].name;
# `name_or_dispatch` also accepts .dispatchName (the workflow dropdown form).
guard_ssot_names() {
  local generated="$1" mode="$2"
  if [ ! -f "$generated" ]; then
    echo "::error::promote input guard: SSOT artifact '$generated' not found; cannot validate service names." >&2
    return 1
  fi
  if [ "$mode" = "name_or_dispatch" ]; then
    jq -r '.services[] | .name, (.dispatchName // empty)' "$generated"
  else
    jq -r '.services[].name' "$generated"
  fi
}

# guard_service_csv <label> <value> <allowed-names (newline list)> [allow_empty]
guard_service_csv() {
  local label="$1" value="$2" allowed="$3" allow_empty="${4:-}"
  local tok tokens
  if [ -z "$value" ]; then
    [ "$allow_empty" = "allow_empty" ] && return 0
    echo "::error::$label is empty; refusing to promote anything." >&2
    return 1
  fi
  case "$value" in
    *[!"$PROMOTE_GUARD_NAME_CHARS",]*)
      echo "::error::$label may contain only lowercase service names (a-z, 0-9, -) joined by commas; no spaces, tabs, CR, LF or other characters. Got: $(printf '%q' "$value")" >&2
      return 1
      ;;
  esac
  case ",$value," in
    *",,"*)
      echo "::error::$label has an empty entry (leading, trailing or doubled comma). Got: $(printf '%q' "$value")" >&2
      return 1
      ;;
  esac
  # Safe to split now: the value is one line of [a-z0-9,-] only.
  IFS=',' read -ra tokens <<< "$value"
  for tok in "${tokens[@]}"; do
    case "$tok" in
      -*)
        echo "::error::$label entry '$tok' starts with '-' and would be read as a CLI option; refusing to promote anything." >&2
        return 1
        ;;
    esac
    if ! printf '%s\n' "$allowed" | grep -qxF -- "$tok"; then
      echo "::error::$label entry '$tok' is not a known SSOT service; refusing to promote anything." >&2
      return 1
    fi
  done
}

# guard_digest <label> <value> — empty is allowed (no override).
guard_digest() {
  local label="$1" value="$2"
  [ -n "$value" ] || return 0
  case "$value" in
    -*|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/:@-]*)
      echo "::error::$label must be an image ref or digest (A-Z a-z 0-9 . _ / : @ -) that does not start with '-'. Got: $(printf '%q' "$value")" >&2
      return 1
      ;;
  esac
}
