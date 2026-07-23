#!/usr/bin/env bash
#
# validate.sh — JSON-validate each promote-notify fixture against the
# Results JSON Schema documented in the spec.
#
# Usage:
#   showcase/test-fixtures/promote-notify/validate.sh
#
# Exits non-zero on the first failed assertion, naming the offending
# file and field. Exits 0 only when ALL fixtures pass.
#
# Required fields (all must be present, with the noted types):
#   schema_version    integer (must equal 1)
#   run_id            string  (6-char lowercase hex)
#   trigger           string  (cli|workflow)
#   operator_email    string
#   operator_git_name string
#   started_at        string  (ISO-8601 UTC)
#   elapsed_seconds   number
#   pre_staging       string  (green|amber|red|skipped)
#   abort_reason      string-or-null (fleet-preflight|per-service|null)
#   succeeded         array
#   failed            array
#
# Each entry in `failed[]` must additionally have:
#   service  string
#   exit     integer-or-null
#   category string

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v jq >/dev/null 2>&1; then
    echo "validate.sh: jq is required" >&2
    exit 2
fi

# Required top-level fields with their jq type checks.
# Format: "field|jq-type-or-predicate"
TOP_FIELDS=(
    "schema_version|number"
    "run_id|string"
    "trigger|string"
    "operator_email|string"
    "operator_git_name|string"
    "started_at|string"
    "elapsed_seconds|number"
    "pre_staging|string"
    "abort_reason|null-or-string"
    "succeeded|array"
    "failed|array"
)

assert_field() {
    local file="$1" field="$2" expected="$3"
    local actual
    actual="$(jq -r --arg f "$field" 'if has($f) then (.[$f] | type) else "MISSING" end' "$file")"
    if [[ "$actual" == "MISSING" ]]; then
        echo "FAIL [$file] missing required field: $field" >&2
        return 1
    fi
    case "$expected" in
        null-or-string)
            if [[ "$actual" != "null" && "$actual" != "string" ]]; then
                echo "FAIL [$file] field $field: expected string-or-null, got $actual" >&2
                return 1
            fi
            ;;
        *)
            if [[ "$actual" != "$expected" ]]; then
                echo "FAIL [$file] field $field: expected $expected, got $actual" >&2
                return 1
            fi
            ;;
    esac
}

assert_schema_version_one() {
    local file="$1"
    # Compare the JSON-text encoding of schema_version. `jq tojson` re-emits
    # the value's JSON representation; an integer 1 renders as "1", a float
    # 1.0 renders as "1.0". Floor-equality (1.0 == floor(1.0)) would have
    # accepted 1.0 — this is the authoritative gate.
    local repr
    repr="$(jq -r '.schema_version | tojson' "$file")"
    if [[ "$repr" != "1" ]]; then
        echo "FAIL [$file] schema_version must be the integer 1 (got JSON: $repr)" >&2
        return 1
    fi
}

assert_outcome_consistency() {
    local file="$1"
    local succ_len fail_len abort
    succ_len="$(jq '.succeeded | length' "$file")"
    fail_len="$(jq '.failed | length' "$file")"
    abort="$(jq -r '.abort_reason // ""' "$file")"
    if (( succ_len == 0 )) && (( fail_len > 0 )); then
        if ! [[ "$abort" =~ ^(fleet-preflight|per-service)$ ]]; then
            echo "FAIL [$file] outcome=total (succeeded empty, failed non-empty) requires abort_reason in {fleet-preflight, per-service}; got '$abort'" >&2
            return 1
        fi
    elif (( succ_len > 0 )); then
        if [[ -n "$abort" ]]; then
            echo "FAIL [$file] outcome=success-or-partial (succeeded non-empty) requires abort_reason=null; got '$abort'" >&2
            return 1
        fi
    fi
}

assert_enum() {
    local file="$1" field="$2" allowed_re="$3"
    local v
    v="$(jq -r --arg f "$field" '.[$f] // ""' "$file")"
    if ! [[ "$v" =~ $allowed_re ]]; then
        echo "FAIL [$file] field $field: '$v' not in allowed set ($allowed_re)" >&2
        return 1
    fi
}

assert_run_id() {
    local file="$1"
    local v
    v="$(jq -r '.run_id' "$file")"
    if ! [[ "$v" =~ ^[0-9a-f]{6}$ ]]; then
        echo "FAIL [$file] run_id: '$v' is not 6-char lowercase hex" >&2
        return 1
    fi
}

assert_iso8601() {
    local file="$1" field="$2"
    local v
    v="$(jq -r --arg f "$field" '.[$f]' "$file")"
    if ! [[ "$v" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
        echo "FAIL [$file] $field: '$v' is not ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ)" >&2
        return 1
    fi
}

assert_abort_reason() {
    local file="$1"
    # Use raw JSON to distinguish null from string "null"
    local raw
    raw="$(jq -r '.abort_reason | if . == null then "@@NULL@@" else . end' "$file")"
    if [[ "$raw" == "@@NULL@@" ]]; then
        return 0  # null is permitted
    fi
    if ! [[ "$raw" =~ ^(fleet-preflight|per-service)$ ]]; then
        echo "FAIL [$file] abort_reason: '$raw' not in (fleet-preflight|per-service|null)" >&2
        return 1
    fi
}

assert_failed_entries() {
    local file="$1"
    local n
    n="$(jq -r '.failed | length' "$file")"
    local i=0
    while (( i < n )); do
        local svc exit_t cat_t
        svc="$(jq -r --argjson i "$i" '.failed[$i].service // "MISSING"' "$file")"
        if [[ "$svc" == "MISSING" ]]; then
            echo "FAIL [$file] failed[$i] missing field: service" >&2
            return 1
        fi
        exit_t="$(jq -r --argjson i "$i" 'if (.failed[$i] | has("exit")) then (.failed[$i].exit | type) else "MISSING" end' "$file")"
        if [[ "$exit_t" == "MISSING" ]]; then
            echo "FAIL [$file] failed[$i] missing field: exit" >&2
            return 1
        fi
        if [[ "$exit_t" != "number" && "$exit_t" != "null" ]]; then
            echo "FAIL [$file] failed[$i].exit: expected number-or-null, got $exit_t" >&2
            return 1
        fi
        cat_t="$(jq -r --argjson i "$i" 'if (.failed[$i] | has("category")) then (.failed[$i].category | type) else "MISSING" end' "$file")"
        if [[ "$cat_t" == "MISSING" ]]; then
            echo "FAIL [$file] failed[$i] missing field: category" >&2
            return 1
        fi
        if [[ "$cat_t" != "string" ]]; then
            echo "FAIL [$file] failed[$i].category: expected string, got $cat_t" >&2
            return 1
        fi
        i=$((i + 1))
    done
}

validate_fixture() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        echo "FAIL [$file] file does not exist" >&2
        return 1
    fi
    if ! jq -e . "$file" >/dev/null 2>&1; then
        echo "FAIL [$file] not valid JSON" >&2
        return 1
    fi
    local local_rc=0
    for spec in "${TOP_FIELDS[@]}"; do
        local field="${spec%%|*}"
        local expected="${spec##*|}"
        assert_field "$file" "$field" "$expected" || local_rc=1
    done
    assert_schema_version_one "$file" || local_rc=1
    assert_failed_entries "$file" || local_rc=1
    # Enum / regex / format assertions declared in the header contract.
    assert_enum "$file" trigger '^(cli|workflow)$' || local_rc=1
    assert_enum "$file" pre_staging '^(green|amber|red|skipped)$' || local_rc=1
    assert_abort_reason "$file" || local_rc=1
    assert_run_id "$file" || local_rc=1
    assert_iso8601 "$file" started_at || local_rc=1
    assert_outcome_consistency "$file" || local_rc=1
    if [[ "$local_rc" -eq 0 ]]; then
        echo "OK   [$file]"
    fi
    return "$local_rc"
}

rc=0
for f in "$DIR/success.json" "$DIR/partial.json" "$DIR/total-failure.json"; do
    validate_fixture "$f" || rc=1
done

exit "$rc"
