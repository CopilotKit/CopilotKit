#!/usr/bin/env bash
#
# Auto-approve safe, read-only CopilotKit CLI operations.
# Called by Claude Code as a PreToolUse hook for Bash commands.
#
# Reads JSON from stdin: {"tool_input": {"command": "..."}}
# Outputs JSON to stdout if auto-approving, otherwise no output (defers to user).

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

if [ -z "$COMMAND" ]; then
    exit 0
fi

# Extract the base command (first word)
BASE_CMD=$(echo "$COMMAND" | awk '{print $1}')

# Only process copilotkit-related commands
case "$BASE_CMD" in
    npx|pnpm|npm|nx|vitest)
        ;;
    *)
        exit 0
        ;;
esac

# ---- NEVER auto-approve destructive operations ----
DESTRUCTIVE_PATTERNS="install|add|remove|delete|publish|deploy|push|uninstall|upgrade|update"
if echo "$COMMAND" | grep -qEi "\b($DESTRUCTIVE_PATTERNS)\b"; then
    exit 0
fi

# ---- Auto-approve read-only operations ----

# npx copilotkit info/help/version commands
if echo "$COMMAND" | grep -qE "^npx\s+copilotkit\s+(--help|--version|info|doctor)"; then
    echo '{"permissionDecision": "allow", "reason": "Read-only CopilotKit CLI command"}'
    exit 0
fi

# pnpm/npm list commands for CopilotKit packages
if echo "$COMMAND" | grep -qE "^(pnpm|npm)\s+(list|ls|why)\s+.*@copilotkit"; then
    echo '{"permissionDecision": "allow", "reason": "Package inspection command"}'
    exit 0
fi

if echo "$COMMAND" | grep -qE "^(pnpm|npm)\s+(list|ls|why)\s+.*@copilotkitnext"; then
    echo '{"permissionDecision": "allow", "reason": "Package inspection command"}'
    exit 0
fi

# ---- Contributor-scoped: test and build commands ----

# nx run tests
if echo "$COMMAND" | grep -qE "^nx\s+run\s+@copilotkit.*:test"; then
    echo '{"permissionDecision": "allow", "reason": "CopilotKit test execution"}'
    exit 0
fi

if echo "$COMMAND" | grep -qE "^nx\s+run\s+@copilotkitnext.*:test"; then
    echo '{"permissionDecision": "allow", "reason": "CopilotKit v2 test execution"}'
    exit 0
fi

# vitest run (in CopilotKit context)
if echo "$COMMAND" | grep -qE "^vitest\s+run"; then
    echo '{"permissionDecision": "allow", "reason": "Vitest test execution"}'
    exit 0
fi

# nx run builds
if echo "$COMMAND" | grep -qE "^nx\s+run\s+@copilotkit.*:build"; then
    echo '{"permissionDecision": "allow", "reason": "CopilotKit build verification"}'
    exit 0
fi

if echo "$COMMAND" | grep -qE "^nx\s+run\s+@copilotkitnext.*:build"; then
    echo '{"permissionDecision": "allow", "reason": "CopilotKit v2 build verification"}'
    exit 0
fi

# Default: don't auto-approve (defer to user)
exit 0
