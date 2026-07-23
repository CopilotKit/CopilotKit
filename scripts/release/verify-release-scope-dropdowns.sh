#!/usr/bin/env bash
# scripts/release/verify-release-scope-dropdowns.sh
#
# Verifies that the hand-maintained `workflow_dispatch` `scope` choice
# dropdowns in the release workflows match the authoritative set of release
# scopes declared in release.config.json (`.scopes` keys, at the REPO ROOT —
# the TS side loads the same file via scripts/release/lib/config.ts).
#
# Why this matters: the release workflows expose a `scope` input as a
# `type: choice` with a hard-coded `options:` list. That list is supposed to
# be "regenerated from release.config.json", but nothing enforced it — so as
# packages were enrolled/renamed in release.config.json the dropdowns could
# drift (newly-enrolled packages wouldn't be canary-selectable; stale scopes
# would linger). This guard fails CI whenever a dropdown diverges from the
# config.
#
# Three files are checked:
#   .github/workflows/publish-release.yml  — canary/prerelease + stable-retry `scope` input
#   .github/workflows/stable-release.yml   — create-pr `scope` input (release / create-pr)
#   .github/workflows/canary.yml           — one-click canary orchestrator `scope` input
#
# Sentinel exception: none of the workflows uses a non-scope sentinel option
# (no `all` / `canary` pseudo-scope — an empty/omitted scope is handled
# outside the options list). If a sentinel is ever introduced, add it to
# SENTINELS below so it is excluded from the equality check.
#
# Secondary projection guarded here: publish-release.yml's `notify` job has a
# `Resolve npm URL for scope` step whose `case "$SCOPE"` maps a dispatch
# scope to a per-scope npm URL. Unlike ag-ui's per-scope ecosystem case
# (which required full coverage), CopilotKit's case uses a `*)` catch-all,
# so full per-scope coverage is NOT required. We instead verify the WEAKER
# but still useful invariant: every EXPLICITLY-named arm (i.e. every arm
# other than the `*)` catch-all) MUST be a valid scope from
# release.config.json. This catches stale or renamed scopes lingering as
# dead arms after a release.config.json rename/removal. See check_notify_case.

set -euo pipefail

# Make sort/comm/diff/string comparison byte-deterministic across environments (macOS vs CI).
export LC_ALL=C

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$REPO_ROOT/release.config.json"
PUBLISH_WF="$REPO_ROOT/.github/workflows/publish-release.yml"
STABLE_WF="$REPO_ROOT/.github/workflows/stable-release.yml"
CANARY_WF="$REPO_ROOT/.github/workflows/canary.yml"

# Documented non-scope sentinel options to ignore (none today). Space-separated.
SENTINELS=""

for f in "$CONFIG" "$PUBLISH_WF" "$STABLE_WF" "$CANARY_WF"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: $f not found" >&2
    exit 1
  fi
done

# Authoritative scope set from release.config.json.
CONFIG_SCOPES=$(jq -r '.scopes | keys[]' "$CONFIG" | sort -u)
if [ -z "$CONFIG_SCOPES" ]; then
  echo "ERROR: no scopes found under '.scopes' in $CONFIG — config corrupt or schema changed." >&2
  exit 1
fi

# Extract the `options:` list belonging to the `scope:` input from a workflow.
# Uses yq when available (the CI path on ubuntu-latest), otherwise a robust awk
# pass (the local-dev fallback):
#   - find the `scope:` input key (an `inputs:` child, indented 6 spaces),
#   - within that block find its `options:` line,
#   - collect the `- value` list items until indentation drops back out.
#
# yq path: the `on` key is quoted as .["on"] so it is read as the literal map
# key and never YAML-1.1-boolean-coerced (`on`/`off`/`yes`/`no` → true/false).
# The result is emitted on stdout; callers MUST treat zero options as a PARSER
# failure (loud), distinct from a real drift mismatch — see check_workflow.
extract_scope_options() {
  local file="$1"
  if command -v yq >/dev/null 2>&1; then
    yq -r '.["on"].workflow_dispatch.inputs.scope.options[]' "$file" | sort -u
    return
  fi
  awk '
    # Match the scope input key: "      scope:" (6-space indent under inputs:).
    /^      scope:[[:space:]]*$/ { in_scope = 1; next }
    # Next sibling input ends the scope block. Match keys with OR without an
    # inline value (the `      scope:` opener is consumed by the rule above).
    in_scope && /^      [a-zA-Z0-9_-]+:/ { in_scope = 0 }
    in_scope && /^        options:[[:space:]]*$/ { in_opts = 1; next }
    in_opts {
      # Skip blank lines and full-line YAML comments so readability whitespace
      # or `# comment` lines between options do not silently terminate the
      # collection (truncating the option set).
      if ($0 ~ /^[[:space:]]*(#|$)/) next
      # An options list item: "          - value"
      if (match($0, /^[[:space:]]*-[[:space:]]+/)) {
        val = $0
        sub(/^[[:space:]]*-[[:space:]]+/, "", val)
        sub(/[[:space:]]*#.*$/, "", val)   # inline YAML comment
        gsub(/^["'"'"']|["'"'"']$/, "", val)       # surrounding quotes
        sub(/[[:space:]]+$/, "", val)
        if (val != "") print val
        next
      }
      # Any non-list-item line ends the options block.
      in_opts = 0
      in_scope = 0
    }
  ' "$file" | sort -u
}

# Strip documented sentinels from an option set before comparing.
strip_sentinels() {
  local opts="$1"
  if [ -z "$SENTINELS" ]; then
    printf '%s\n' "$opts"
    return
  fi
  local filtered="$opts"
  for s in $SENTINELS; do
    # Fixed-string match: sentinels containing regex metacharacters must not over-match.
    filtered=$(printf '%s\n' "$filtered" | grep -Fvx -- "$s" || true)
  done
  printf '%s\n' "$filtered"
}

check_workflow() {
  local name="$1" file="$2"
  local opts
  opts=$(extract_scope_options "$file")
  opts=$(strip_sentinels "$opts")

  # Zero options means the PARSER could not locate the scope options block (a
  # yq/awk extraction failure or a structural change to the workflow), NOT that
  # the dropdown drifted. Fail LOUD and distinctly so this is never mistaken for
  # a real drift mismatch (which prints a diff below).
  if [ -z "$opts" ]; then
    echo "ERROR: parser could not find scope options in $file ($name)." >&2
    echo "       Extracted ZERO options via $(command -v yq >/dev/null 2>&1 && echo yq || echo 'awk fallback')." >&2
    echo "       This is a PARSER failure (not a drift mismatch): the 'scope' input's" >&2
    echo "       'options:' list could not be located. Check the workflow structure or" >&2
    echo "       the extractor in this script." >&2
    return 1
  fi

  if [ "$opts" = "$CONFIG_SCOPES" ]; then
    echo "OK: $name scope dropdown matches release.config.json scopes"
    return 0
  fi

  echo "ERROR: $name scope dropdown is out of sync with release.config.json." >&2
  echo "" >&2
  echo "--- diff (release.config.json scopes  vs  $name options) ---" >&2
  diff <(printf '%s\n' "$CONFIG_SCOPES") <(printf '%s\n' "$opts") >&2 || true
  echo "" >&2
  echo "Fix: update the 'scope' input 'options:' list in $file to exactly match" >&2
  echo "the keys of '.scopes' in release.config.json" >&2
  echo "(plus any documented sentinel listed in SENTINELS within this script)." >&2
  return 1
}

# Verify the notify-job `Resolve npm URL for scope` step in publish-release.yml.
# That step's `case "$SCOPE"` maps a dispatch scope to a per-scope npm URL.
# CopilotKit's case uses a `*)` catch-all (unlike ag-ui's per-scope ecosystem
# case which required full coverage), so we cannot assert full coverage here.
# What we CAN — and do — assert is the weaker but still useful invariant:
# every EXPLICITLY-named arm (every arm whose pattern is not `*`) MUST be a
# valid scope from release.config.json. This catches stale/renamed scopes
# lingering as dead arms after a config rename or removal.
check_notify_case() {
  local file="$1"

  # Guard against silent parser degradation: this awk only recognizes the
  # literal form `case "$SCOPE" in` and only the FIRST such block. If the
  # workflow is refactored to e.g. `case "${SCOPE}" in`, or if a second block
  # is added, the strict parser would silently validate nothing. Cross-check
  # a loose grep against the strict form and fail loudly on mismatch.
  #
  # Both regexes are anchored to the start of the line (allowing only leading
  # whitespace) so that prose comments mentioning the words case/SCOPE/in
  # cannot trip the guard. Comments start with `#`, so `case` is never their
  # first non-whitespace token.
  local loose_count strict_count
  loose_count=$(grep -cE '^[[:space:]]*case[[:space:]].*SCOPE.*[[:space:]]in([[:space:]]|$)' "$file" || true)
  # Default to 0 on a hard grep failure: `grep -c ... || true` yields "0" on
  # no-match (grep prints 0, exits 1) but EMPTY if grep itself fails (e.g.
  # unreadable file), which would make the later integer `-ne` test die
  # cryptically. Same below.
  loose_count=${loose_count:-0}
  # shellcheck disable=SC2016  # literal $SCOPE is intentional — we are matching shell source text, not expanding
  strict_count=$(grep -cE '^[[:space:]]*case[[:space:]]+"\$SCOPE"[[:space:]]+in' "$file" || true)
  strict_count=${strict_count:-0}
  if [ "$loose_count" -ne "$strict_count" ]; then
    echo "ERROR: $file has $loose_count case-on-SCOPE statement(s) but only $strict_count match the strict 'case \"\$SCOPE\" in' form this parser understands." >&2
    echo "Update check_notify_case() in $0 to handle the new form." >&2
    return 1
  fi
  if [ "$strict_count" -gt 1 ]; then
    echo "ERROR: $file has $strict_count 'case \"\$SCOPE\" in' blocks; this parser validates only the first." >&2
    echo "Update check_notify_case() in $0 to validate every block." >&2
    return 1
  fi
  if [ "$strict_count" -eq 0 ]; then
    echo "ERROR: no 'case \"\$SCOPE\" in' block found in $file." >&2
    echo "The notify-job npm-url step was removed or restructured; update or remove check_notify_case() in $0 accordingly." >&2
    return 1
  fi

  # Pull the explicit case-arm patterns from the FIRST `case "$SCOPE" in ...
  # esac` block in the file. The notify job's `Resolve npm URL for scope` step
  # is the only `case "$SCOPE"` in publish-release.yml; if more are added,
  # this single-block parser will need updating.
  local actual_explicit
  actual_explicit=$(awk '
    /^[[:space:]]*case[[:space:]]+"\$SCOPE"[[:space:]]+in/ { in_case = 1; next }
    in_case && /^[[:space:]]*esac[[:space:]]*$/ { in_case = 0; exit }
    # Comment lines inside the case body are never arms — skip them BEFORE the
    # arm matcher (a comment like `# maps angular)` ends in ")" and would
    # otherwise be misparsed as a stale arm).
    in_case && /^[[:space:]]*#/ { next }
    # Arm-shaped lines only: the entire line before the closing ")" must be
    # pattern characters — extended to allow space and surrounding quotes so
    # we accept legal forms like `"angular")` and `channels | channels-slack)`. We use a
    # negated class that still excludes `=`, `$`, `(`, `:`, `/` (and `)` since
    # `)` is the terminator) so body lines like `FOO=$(cmd)` or
    # `path: /tmp/foo)` cannot match.
    in_case && /^[[:space:]]*[^=$(:\/)]+\)[[:space:]]*$/ {
      line = $0
      sub(/[[:space:]]*\)[[:space:]]*$/, "", line)   # drop trailing ")"
      sub(/^[[:space:]]+/, "", line)                 # drop leading indent
      # Skip the catch-all arm.
      if (line == "*") next
      # Alternation: a|b|c — split on `|` and emit each pattern. Strip
      # surrounding whitespace and surrounding quotes (single or double) from
      # each alternative so `"angular"` and `channels | channels-slack` both yield the
      # bare scope name. The '"'"' pattern is how a single quote is embedded
      # inside a single-quoted shell heredoc (see line ~95 above).
      n = split(line, arr, "|")
      for (i = 1; i <= n; i++) {
        p = arr[i]
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", p)
        gsub(/^["'"'"']|["'"'"']$/, "", p)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", p)
        if (p != "" && p != "*") print p
      }
    }
  ' "$file" | sort -u)

  # If there are no explicit arms (the case is `*)` only), nothing to check.
  if [ -z "$actual_explicit" ]; then
    echo "OK: publish-release.yml notify-job npm-url case has only a catch-all (nothing to validate)"
    return 0
  fi

  # Every explicit arm must be a valid config scope.
  local stale
  stale=$(comm -23 <(printf '%s\n' "$actual_explicit") <(printf '%s\n' "$CONFIG_SCOPES"))

  if [ -n "$stale" ]; then
    echo "ERROR: publish-release.yml notify-job npm-url case names scope(s) not in release.config.json:" >&2
    printf '%s\n' "$stale" | sed 's/^/  /' >&2
    echo "" >&2
    echo "Fix: remove or rename the stale arm(s) in the 'Resolve npm URL for scope' step" >&2
    echo "so every explicitly-named case arm matches a key under '.scopes' in" >&2
    echo "release.config.json. (The '*)' catch-all handles scopes without a custom URL," >&2
    echo "so full per-scope coverage is intentionally NOT required.)" >&2
    return 1
  fi

  echo "OK: publish-release.yml notify-job npm-url case explicit arms are all valid scopes"
  return 0
}

rc=0
check_workflow "publish-release.yml" "$PUBLISH_WF" || rc=1
check_workflow "stable-release.yml"  "$STABLE_WF"  || rc=1
check_workflow "canary.yml"          "$CANARY_WF"  || rc=1
check_notify_case "$PUBLISH_WF" || rc=1

if [ "$rc" -ne 0 ]; then
  exit 1
fi

echo "OK: all release scope dropdowns match release.config.json; notify-job npm-url case explicit arms are all valid scopes"
exit 0
