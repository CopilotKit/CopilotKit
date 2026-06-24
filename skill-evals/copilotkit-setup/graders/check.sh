#!/usr/bin/env bash
# Deterministic correctness grader for the copilotkit-setup skill eval.
#
# CONTRACT: prints a single JSON object to stdout:
#   {"score": 0-1, "details": "...", "checks": [{"name","passed","message"}, ...]}
#
# WHAT THIS GRADES: the agent was asked to add CopilotKit to an existing
# Vite+React app at /workspace — frontend @copilotkit/react-core, a backend
# (Express/Hono) running a CopilotRuntime + BuiltInAgent via @copilotkit/runtime,
# the <CopilotKit> provider, a CopilotSidebar (or other chat UI), and the
# stylesheet import. The backend may live at root or in a subdir (e.g. server/).
#
# THE GATE: this grader actually TYPE-CHECKS the project — it does not merely
# grep for API names. A project that does not type-check is not a working setup.
# For every project dir with a package.json (the root vite app + any backend
# subdir) we run a type-check (the dir's own `typecheck` npm script if defined,
# else `npx tsc --noEmit -p <dir>`). Type-check is THE dominant signal.
#
# SCORING (documented here, computed below with awk; node:20-slim has NO bc):
#   total = 0.60 * GATE + 0.40 * STRINGS
#   - GATE   = fraction of discovered project dirs whose type-check exits 0.
#              If no project dir is found, GATE = 0.
#   - STRINGS = fraction of the 7 source/string checks (2-8 below) that pass.
#   Because GATE carries 0.60 and a non-compiling project drives GATE toward 0,
#   a project that does not compile is capped well below the 0.8 threshold even
#   if every string is present (max ~0.40). The gate is meaningful.
#
# GRADER-POISONING GUARD: skillgrade bakes the skill (incl. its assets/*.tsx
# example code) into /workspace/.agents/skills and /workspace/.claude/skills.
# EVERY source scan and package.json find MUST exclude those dirs (and
# node_modules) or a no-op agent scores points off the skill's own examples.

set -u

WORKSPACE="${WORKSPACE:-/workspace}"

# --- helpers ---------------------------------------------------------------

# JSON-escape a string for embedding as a JSON value (uses jq, which is present).
json_escape() {
  printf '%s' "$1" | jq -Rs .
}

# Truncate a string to N chars (default 400) so error messages stay readable.
truncate_msg() {
  local s="$1" n="${2:-400}"
  if [ "${#s}" -gt "$n" ]; then
    printf '%s…(truncated)' "${s:0:$n}"
  else
    printf '%s' "$s"
  fi
}

# Accumulators for the 7 string checks.
STRING_PASS=0
STRING_TOTAL=0
# Collected check JSON fragments.
CHECKS_JSON=""

add_check() {
  # add_check <name> <passed:true|false> <message>
  local name="$1" passed="$2" message="$3"
  local frag
  frag=$(jq -n \
    --arg name "$name" \
    --argjson passed "$passed" \
    --arg message "$message" \
    '{name:$name, passed:$passed, message:$message}')
  if [ -z "$CHECKS_JSON" ]; then
    CHECKS_JSON="$frag"
  else
    CHECKS_JSON="$CHECKS_JSON,$frag"
  fi
}

add_string_check() {
  # add_string_check <name> <passed:true|false> <message>
  STRING_TOTAL=$((STRING_TOTAL + 1))
  if [ "$2" = "true" ]; then
    STRING_PASS=$((STRING_PASS + 1))
  fi
  add_check "$1" "$2" "$3"
}

# Source grep across the workspace, excluding poisoning dirs + node_modules.
# Usage: src_grep <extended-regex>  -> exit 0 if found.
src_grep() {
  grep -rEl "$1" "$WORKSPACE" \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    --include='*.mts' --include='*.cts' --include='*.mjs' --include='*.cjs' \
    --exclude-dir=node_modules --exclude-dir=.agents --exclude-dir=.claude \
    --exclude-dir=.git --exclude-dir=dist --exclude-dir=build \
    >/dev/null 2>&1
}

# --- 1. THE GATE: type-check every project dir ----------------------------

# Find package.json files, excluding poisoning dirs + node_modules. These are
# the project roots we type-check.
PKG_FILES=$(find "$WORKSPACE" -name package.json \
  -not -path '*/node_modules/*' \
  -not -path '*/.agents/*' \
  -not -path '*/.claude/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/build/*' \
  2>/dev/null)

GATE_TOTAL=0
GATE_PASS=0

if [ -z "$PKG_FILES" ]; then
  add_check "type-check (gate)" false "No package.json found in workspace — cannot type-check any project."
else
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    dir=$(dirname "$pkg")
    GATE_TOTAL=$((GATE_TOTAL + 1))

    # Ensure deps are installed (the agent should have run npm install, but a
    # backend subdir may have been left uninstalled). npm install may be slow;
    # that is acceptable per the grader spec.
    if [ ! -d "$dir/node_modules" ]; then
      ( cd "$dir" && npm install ) >/dev/null 2>&1
    fi

    # Prefer the project's own `typecheck` npm script if it defines one.
    has_typecheck_script=$(jq -r '.scripts.typecheck // empty' "$pkg" 2>/dev/null)

    tc_out=""
    tc_rc=0
    if [ -n "$has_typecheck_script" ]; then
      tc_out=$( cd "$dir" && npm run typecheck 2>&1 )
      tc_rc=$?
    else
      tc_out=$( cd "$dir" && npx --yes tsc --noEmit -p "$dir" 2>&1 )
      tc_rc=$?
    fi

    rel="${dir#$WORKSPACE/}"
    [ "$rel" = "$dir" ] && rel="(root)"
    if [ "$tc_rc" -eq 0 ]; then
      GATE_PASS=$((GATE_PASS + 1))
      add_check "type-check: $rel" true "Type-check passed."
    else
      msg=$(truncate_msg "$(printf '%s' "$tc_out" | tail -c 600)")
      add_check "type-check: $rel" false "Type-check FAILED (exit $tc_rc): $msg"
    fi
  done <<EOF
$PKG_FILES
EOF
fi

# --- 2-3. Packages installed (search all non-excluded package.json deps) ---

# Collect dependency names from every relevant package.json (deps +
# devDependencies + peerDependencies), excluding poisoning dirs.
DEP_NAMES=""
if [ -n "$PKG_FILES" ]; then
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    names=$(jq -r '
      ((.dependencies // {}) + (.devDependencies // {}) + (.peerDependencies // {}))
      | keys[]?' "$pkg" 2>/dev/null)
    DEP_NAMES="$DEP_NAMES
$names"
  done <<EOF
$PKG_FILES
EOF
fi

dep_present() {
  printf '%s\n' "$DEP_NAMES" | grep -qx "$1"
}

if dep_present "@copilotkit/react-core"; then
  add_string_check "frontend package (@copilotkit/react-core)" true "Found in a package.json dependency list."
else
  add_string_check "frontend package (@copilotkit/react-core)" false "@copilotkit/react-core not found in any package.json."
fi

if dep_present "@copilotkit/runtime"; then
  add_string_check "runtime package (@copilotkit/runtime)" true "Found in a package.json dependency list."
else
  add_string_check "runtime package (@copilotkit/runtime)" false "@copilotkit/runtime not found in any package.json."
fi

# --- 4. Canonical handler factory -----------------------------------------
# createCopilotExpressHandler OR createCopilotHonoHandler. The deprecated
# createCopilotEndpoint* names do NOT count.
if src_grep 'createCopilot(Express|Hono)Handler'; then
  add_string_check "canonical handler factory" true "createCopilotExpressHandler or createCopilotHonoHandler present in source."
else
  add_string_check "canonical handler factory" false "Neither createCopilotExpressHandler nor createCopilotHonoHandler found (deprecated createCopilotEndpoint* does not count)."
fi

# --- 5. BuiltInAgent configured -------------------------------------------
if src_grep 'BuiltInAgent'; then
  add_string_check "BuiltInAgent configured" true "BuiltInAgent present in source."
else
  add_string_check "BuiltInAgent configured" false "BuiltInAgent not found in source."
fi

# --- 6. Provider <CopilotKit> from react-core/v2 --------------------------
# Provider element <CopilotKit ...> (regex <CopilotKit([^A-Za-z]|$) so the
# legacy <CopilotKitProvider> does NOT count) AND imported from
# @copilotkit/react-core/v2.
PROVIDER_ELEM=false
PROVIDER_IMPORT=false
src_grep '<CopilotKit([^A-Za-z]|$)' && PROVIDER_ELEM=true
src_grep '@copilotkit/react-core/v2' && PROVIDER_IMPORT=true
if [ "$PROVIDER_ELEM" = true ] && [ "$PROVIDER_IMPORT" = true ]; then
  add_string_check "provider <CopilotKit> from react-core/v2" true "<CopilotKit> element and @copilotkit/react-core/v2 import both present."
else
  add_string_check "provider <CopilotKit> from react-core/v2" false "Need <CopilotKit> element (not <CopilotKitProvider>) AND @copilotkit/react-core/v2 import. element=$PROVIDER_ELEM import=$PROVIDER_IMPORT"
fi

# --- 7. Chat UI component -------------------------------------------------
if src_grep 'CopilotSidebar|CopilotChat|CopilotPopup'; then
  add_string_check "chat UI component" true "CopilotSidebar / CopilotChat / CopilotPopup present in source."
else
  add_string_check "chat UI component" false "No CopilotSidebar / CopilotChat / CopilotPopup found in source."
fi

# --- 8. Stylesheet imported -----------------------------------------------
# @copilotkit/react-core/v2/styles.css  (escape the dot for the regex).
if src_grep '@copilotkit/react-core/v2/styles\.css'; then
  add_string_check "stylesheet imported" true "@copilotkit/react-core/v2/styles.css import present."
else
  add_string_check "stylesheet imported" false "@copilotkit/react-core/v2/styles.css import not found."
fi

# --- Score ----------------------------------------------------------------
# total = 0.60 * (GATE_PASS/GATE_TOTAL) + 0.40 * (STRING_PASS/STRING_TOTAL)
SCORE=$(awk -v gp="$GATE_PASS" -v gt="$GATE_TOTAL" -v sp="$STRING_PASS" -v st="$STRING_TOTAL" 'BEGIN{
  gate = (gt > 0) ? gp/gt : 0;
  strings = (st > 0) ? sp/st : 0;
  total = 0.60*gate + 0.40*strings;
  printf "%.4f", total;
}')

GATE_FRAC=$(awk -v gp="$GATE_PASS" -v gt="$GATE_TOTAL" 'BEGIN{printf "%d/%d", gp, gt}')
STR_FRAC=$(awk -v sp="$STRING_PASS" -v st="$STRING_TOTAL" 'BEGIN{printf "%d/%d", sp, st}')

DETAILS="Type-check gate: $GATE_FRAC project dir(s) passed (weight 0.60). String checks: $STR_FRAC passed (weight 0.40). Score=$SCORE."

DETAILS_JSON=$(json_escape "$DETAILS")

printf '{"score": %s, "details": %s, "checks": [%s]}\n' "$SCORE" "$DETAILS_JSON" "$CHECKS_JSON"
