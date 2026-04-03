#!/usr/bin/env bash
#
# install.sh
#
# Installs CopilotKit skills for AI coding agents. Detects which tools are
# installed (Claude Code, Codex, Cursor, OpenCode) and copies skills to each.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/CopilotKit/skills/main/scripts/install.sh | bash
#   ./scripts/install.sh [--update] [--tools claude,codex,cursor,opencode]
#
# Options:
#   --update    Re-install (overwrite existing skill files)
#   --tools     Comma-separated list of tools to install for (default: all detected)
#   --help      Show this help message

set -euo pipefail

REPO_URL="https://github.com/CopilotKit/skills.git"
CLONE_DIR="${TMPDIR:-/tmp}/copilotkit-skills-$$"
UPDATE=false
TOOLS_FILTER=""

# ──────────────────────────────────────────────
# Tool detection
# ──────────────────────────────────────────────

declare -A TOOL_DIRS
TOOL_DIRS=(
    [claude]="$HOME/.claude/skills"
    [codex]="$HOME/.codex/skills"
    [cursor]="$HOME/.cursor/skills"
    [opencode]="$HOME/.config/opencode/skills"
)

declare -A TOOL_NAMES
TOOL_NAMES=(
    [claude]="Claude Code"
    [codex]="Codex"
    [cursor]="Cursor"
    [opencode]="OpenCode"
)

detect_tools() {
    local detected=()

    # Claude Code: check for ~/.claude directory
    if [ -d "$HOME/.claude" ]; then
        detected+=(claude)
    fi

    # Codex: check for ~/.codex directory
    if [ -d "$HOME/.codex" ]; then
        detected+=(codex)
    fi

    # Cursor: check for ~/.cursor directory
    if [ -d "$HOME/.cursor" ]; then
        detected+=(cursor)
    fi

    # OpenCode: check for ~/.config/opencode directory
    if [ -d "$HOME/.config/opencode" ]; then
        detected+=(opencode)
    fi

    echo "${detected[*]}"
}

# ──────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
    case "$1" in
        --update)
            UPDATE=true
            shift
            ;;
        --tools)
            TOOLS_FILTER="$2"
            shift 2
            ;;
        --help|-h)
            head -20 "$0" | grep '^#' | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
    esac
done

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

echo "CopilotKit Skills Installer"
echo "==========================="
echo ""

# Determine target tools
if [ -n "$TOOLS_FILTER" ]; then
    IFS=',' read -ra TARGET_TOOLS <<< "$TOOLS_FILTER"
else
    read -ra TARGET_TOOLS <<< "$(detect_tools)"
fi

if [ ${#TARGET_TOOLS[@]} -eq 0 ]; then
    echo "No supported AI coding tools detected."
    echo ""
    echo "Supported tools and their expected locations:"
    echo "  Claude Code  ~/.claude/"
    echo "  Codex        ~/.codex/"
    echo "  Cursor       ~/.cursor/"
    echo "  OpenCode     ~/.config/opencode/"
    echo ""
    echo "Install one of these tools first, or use --tools to specify targets."
    exit 1
fi

echo "Detected tools:"
for tool in "${TARGET_TOOLS[@]}"; do
    echo "  - ${TOOL_NAMES[$tool]:-$tool}"
done
echo ""

# Clone the repo
echo "Fetching CopilotKit skills..."
git clone --depth 1 --quiet "$REPO_URL" "$CLONE_DIR" 2>/dev/null || {
    echo "ERROR: Failed to clone skills repository." >&2
    echo "Check your network connection and try again." >&2
    exit 1
}

# Find available skills
skills=()
for skill_dir in "$CLONE_DIR"/skills/copilotkit-*/; do
    [ -d "$skill_dir" ] || continue
    skills+=("$(basename "$skill_dir")")
done

if [ ${#skills[@]} -eq 0 ]; then
    echo "ERROR: No skills found in repository." >&2
    rm -rf "$CLONE_DIR"
    exit 1
fi

echo "Found ${#skills[@]} skills: ${skills[*]}"
echo ""

# Install skills for each target tool
installed_count=0
skipped_count=0

for tool in "${TARGET_TOOLS[@]}"; do
    target_dir="${TOOL_DIRS[$tool]}"
    tool_name="${TOOL_NAMES[$tool]:-$tool}"

    echo "Installing for ${tool_name} (${target_dir})..."

    # Create the skills directory if it doesn't exist
    mkdir -p "$target_dir"

    for skill in "${skills[@]}"; do
        dest="${target_dir}/${skill}"

        if [ -d "$dest" ] && [ "$UPDATE" = false ]; then
            echo "  SKIP: ${skill} (already exists, use --update to overwrite)"
            skipped_count=$((skipped_count + 1))
            continue
        fi

        # Remove existing and copy fresh
        rm -rf "$dest"
        cp -R "$CLONE_DIR/skills/${skill}" "$dest"
        echo "  OK:   ${skill}"
        installed_count=$((installed_count + 1))
    done

    echo ""
done

# Clean up
rm -rf "$CLONE_DIR"

# Summary
echo "==========================="
echo "Installation complete."
echo "  Installed: ${installed_count} skill(s)"
if [ $skipped_count -gt 0 ]; then
    echo "  Skipped:   ${skipped_count} skill(s) (use --update to overwrite)"
fi
echo ""

# MCP setup instructions
echo "MCP Server Setup (optional)"
echo "---------------------------"
echo "For live documentation access, configure your tool's MCP server:"
echo ""
echo "  Server URL: https://mcp.copilotkit.ai/mcp"
echo ""
echo "  Claude Code: Add to .mcp.json:"
echo '    { "mcpServers": { "copilotkit-docs": { "type": "http", "url": "https://mcp.copilotkit.ai/mcp" } } }'
echo ""
echo "  Codex: Add to .codex/config.toml:"
echo '    [mcp_servers.copilotkit-docs]'
echo '    type = "http"'
echo '    url = "https://mcp.copilotkit.ai/mcp"'
echo ""
echo "  Cursor/OpenCode: Configure an HTTP MCP server pointing to https://mcp.copilotkit.ai/mcp"
echo ""
echo "For more details, see: https://github.com/CopilotKit/skills#mcp-integration"
