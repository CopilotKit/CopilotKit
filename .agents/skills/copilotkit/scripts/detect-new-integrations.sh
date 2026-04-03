#!/usr/bin/env bash
# Requires bash 4+ for associative arrays. On macOS, use /opt/homebrew/bin/bash.
#
# detect-new-integrations.sh
#
# Compares integration example directories in CopilotKit/CopilotKit against
# existing guide files in this repo. Outputs names of integrations that have
# an example directory but no corresponding guide.
#
# Usage:
#   ./scripts/detect-new-integrations.sh <copilotkit-repo-path> [guides-dir]
#
# Arguments:
#   copilotkit-repo-path  Path to the checked-out CopilotKit/CopilotKit repo
#   guides-dir            Path to integration guides (default: skills/copilotkit-integrations/references/integrations)
#
# Output:
#   One integration name per line for each new (unmatched) integration.
#   Exit code 0 if new integrations found, 1 if none found.

set -euo pipefail

COPILOTKIT_REPO="${1:?Usage: $0 <copilotkit-repo-path> [guides-dir]}"
GUIDES_DIR="${2:-skills/copilotkit-integrations/references/integrations}"

EXAMPLES_DIR="${COPILOTKIT_REPO}/examples/integrations"

if [ ! -d "$EXAMPLES_DIR" ]; then
    echo "WARNING: examples/integrations directory not found at ${EXAMPLES_DIR}" >&2
    echo "This may mean the CopilotKit repo structure has changed." >&2
    exit 1
fi

if [ ! -d "$GUIDES_DIR" ]; then
    echo "ERROR: Guides directory not found at ${GUIDES_DIR}" >&2
    exit 1
fi

# Map example directory names to guide filenames.
# Multiple example dirs can map to a single guide (e.g., langgraph-js,
# langgraph-python, langgraph-fastapi all map to langgraph.md).
declare -A dir_to_guide
dir_to_guide=(
    ["a2a-a2ui"]="a2a"
    ["a2a-middleware"]="a2a"
    ["mcp-apps"]="a2a"
    ["crewai-crews"]="crewai"
    ["crewai-flows"]="crewai"
    ["langgraph-js"]="langgraph"
    ["langgraph-python"]="langgraph"
    ["langgraph-fastapi"]="langgraph"
    ["ms-agent-framework-python"]="ms-agent-framework"
    ["ms-agent-framework-dotnet"]="ms-agent-framework"
    ["strands-python"]="strands"
    ["agent-spec"]=""
    ["agentcore"]=""
)

# Collect existing guide names (filename without .md extension)
declare -A existing_guides
for guide_file in "$GUIDES_DIR"/*.md; do
    [ -f "$guide_file" ] || continue
    basename="${guide_file##*/}"
    name="${basename%.md}"
    existing_guides["$name"]=1
done

# Compare against example directories
new_integrations=()
for example_dir in "$EXAMPLES_DIR"/*/; do
    [ -d "$example_dir" ] || continue
    dirname="${example_dir%/}"
    name="${dirname##*/}"

    # Skip hidden directories and common non-integration dirs
    [[ "$name" == .* ]] && continue
    [[ "$name" == "node_modules" ]] && continue

    # Resolve directory name to guide name via mapping
    guide_name="${dir_to_guide[$name]-$name}"

    # Empty mapping means intentionally skipped (e.g., agent-spec)
    [ -z "$guide_name" ] && continue

    if [ -z "${existing_guides[$guide_name]+x}" ]; then
        # Only add once per guide name
        local_already=false
        for existing in "${new_integrations[@]:-}"; do
            [ "$existing" = "$guide_name" ] && local_already=true && break
        done
        $local_already || new_integrations+=("$guide_name")
    fi
done

# Exit code convention: 0 = new integrations found (success/action needed),
# 1 = no new integrations (nothing to do). This is intentional -- the CI
# workflow treats "found new integrations" as the success case that triggers
# Strategy 2 guide generation. Callers should use `|| true` to prevent
# set -e from aborting when no new integrations exist.
if [ ${#new_integrations[@]} -eq 0 ]; then
    echo "No new integrations detected." >&2
    exit 1
fi

# Output new integration names, one per line
for name in "${new_integrations[@]}"; do
    echo "$name"
done
