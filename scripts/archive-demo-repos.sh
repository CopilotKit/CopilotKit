#!/usr/bin/env bash
set -euo pipefail

# Archive script: update README with deprecation notice, then archive demo repos
# Usage: ./scripts/archive-demo-repos.sh [--group A|B|C|D|all] [--dry-run]

CLONE_DIR="$(mktemp -d)"
trap 'rm -rf "$CLONE_DIR"' EXIT

GROUP_FILTER="all"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --group) GROUP_FILTER="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        *) shift ;;
    esac
done

# Track results for summary
ARCHIVED=0
FAILED=0
FAILURES=()

log_failure() { FAILURES+=("$1"); echo "  FAILED: $1"; }

archive_repo() {
    local repo="$1"
    local target_path="$2"

    echo "==> Archiving CopilotKit/$repo (-> $target_path)"

    if [[ $DRY_RUN -eq 1 ]]; then
        echo "  DRY RUN: Would update README and archive CopilotKit/$repo"
        ((ARCHIVED++))
        return 0
    fi

    # Step 1: Shallow clone
    local clone_dest="$CLONE_DIR/$repo"
    rm -rf "$clone_dest"

    if ! git clone --depth 1 "https://github.com/CopilotKit/${repo}.git" "$clone_dest" 2>/dev/null; then
        log_failure "$repo: Could not clone"
        ((FAILED++))
        return 0
    fi

    # Step 2: Replace README with deprecation notice
    cat > "$clone_dest/README.md" <<README_EOF
# This repository has been archived

This project has been consolidated into the [CopilotKit monorepo](https://github.com/CopilotKit/CopilotKit).

**New location:** [\`${target_path}\`](https://github.com/CopilotKit/CopilotKit/tree/main/${target_path})

Please open issues and pull requests in the [main CopilotKit repository](https://github.com/CopilotKit/CopilotKit).
README_EOF

    # Step 3: Commit and push the updated README
    if ! (cd "$clone_dest" && git add README.md && git commit -m "Point to monorepo location before archiving" --quiet && git push --quiet); then
        log_failure "$repo: Could not push deprecation README"
        ((FAILED++))
        rm -rf "$clone_dest"
        return 0
    fi

    rm -rf "$clone_dest"

    # Step 4: Archive the repo
    if ! gh repo archive "CopilotKit/$repo" --yes 2>/dev/null; then
        log_failure "$repo: Could not archive (README was updated)"
        ((FAILED++))
        return 0
    fi

    ((ARCHIVED++))
    echo "  OK: Archived CopilotKit/$repo"
}

# ============================================================
# MANIFEST: All 54 consolidated repos organized by group
# Format: archive_repo <github-repo-name> <target-path>
#
# NOT archived (not consolidated — experiments and dropped showcases):
#   vnext_experimental_angular_demo, 1.50-demo, private_a2ui_demo,
#   llamaindex-composio-hackathon-sample, vnext-with-pydantic,
#   copilotkit-jupyter-notebook, deep-agent-cpk-experiments,
#   crew-flow-ent-dojo, crew-flow-cpk-temp, ag2-feature-viewer,
#   ag-ui-expo-playground, find-the-bug, cuddly-fortnight,
#   crew_ai_enterprise_demo, agui-demo, demo-campaign-manager,
#   demo-chat-sso, demo-crm, autotale-ai-web-ui
# ============================================================

archive_group_a() {
    echo ""
    echo "========== GROUP A: Demo Team Repos (24) =========="
    echo ""
    archive_repo with-langgraph-python           examples/integrations/langgraph-python
    archive_repo with-langgraph-js               examples/integrations/langgraph-js
    archive_repo with-langgraph-fastapi           examples/integrations/langgraph-fastapi
    archive_repo with-mastra                      examples/integrations/mastra
    archive_repo with-crewai-flows                examples/integrations/crewai-flows
    archive_repo with-llamaindex                  examples/integrations/llamaindex
    archive_repo with-pydantic-ai                 examples/integrations/pydantic-ai
    archive_repo with-microsoft-agent-framework-python examples/integrations/ms-agent-framework-python
    archive_repo with-microsoft-agent-framework-dotnet examples/integrations/ms-agent-framework-dotnet
    archive_repo with-strands-python              examples/integrations/strands-python
    archive_repo with-mcp-apps                    examples/integrations/mcp-apps
    archive_repo with-adk                         examples/integrations/adk
    archive_repo with-agent-spec                  examples/integrations/agent-spec
    archive_repo with-a2a-a2ui                    examples/integrations/a2a-a2ui
    archive_repo demo-banking                     examples/showcases/banking
    archive_repo demo-presentation                examples/showcases/presentation
    archive_repo example-textarea                 examples/starters/textarea
    archive_repo example-todos-app                examples/starters/todos-app
    archive_repo deep-agents-demo                 examples/showcases/deep-agents
    archive_repo deep-agents-job-search-assistant examples/showcases/deep-agents-job-search
    archive_repo generative-ui                    examples/showcases/generative-ui
    archive_repo generative-ui-playground         examples/showcases/generative-ui-playground
    archive_repo mcp-apps-demo                    examples/showcases/mcp-apps
    archive_repo open-research-ANA                examples/showcases/research-canvas
}

archive_group_b() {
    echo ""
    echo "========== GROUP B: Additional Repos (24) =========="
    echo ""
    # Integration starters
    archive_repo with-agno                        examples/integrations/agno
    archive_repo with-crewai-crews                examples/integrations/crewai-crews
    archive_repo with-a2a-middleware               examples/integrations/a2a-middleware

    # Canvas demos
    archive_repo canvas-with-langgraph-python      examples/canvas/langgraph-python
    archive_repo canvas-with-llamaindex            examples/canvas/llamaindex
    archive_repo canvas-with-llamaindex-composio   examples/canvas/llamaindex-composio
    archive_repo canvas-with-pydantic-ai           examples/canvas/pydantic-ai
    archive_repo canvas-with-mastra                examples/canvas/mastra

    # Feature demos
    archive_repo copilotkit-mcp-demo              examples/showcases/mcp-demo
    archive_repo strands-file-analyzer-demo       examples/showcases/strands-file-analyzer
    archive_repo microsoft-kanban-demo            examples/showcases/microsoft-kanban
    archive_repo multi-page-demo                  examples/showcases/multi-page
    archive_repo orca-CopilotKit-demo             examples/showcases/orca

    # Starters and showcases
    archive_repo coagents-starter-langgraph       examples/starters/coagents-langgraph
    archive_repo coagents-starter-crewai-flows    examples/starters/coagents-crewai-flows
    archive_repo pydantic-ai-todos                examples/showcases/pydantic-ai-todos
    archive_repo scene-creator-copilot            examples/showcases/scene-creator
    archive_repo open-gemini-canvas               examples/canvas/gemini
    archive_repo llamaindex-hitl-guide-example    examples/starters/llamaindex-hitl
    archive_repo adk-generative-dashboard         examples/showcases/adk-dashboard
    archive_repo mastra-pm-canvas                 examples/canvas/mastra-pm
    archive_repo langgraph-js-support-agents      examples/showcases/langgraph-js-support-agents
    archive_repo open-multi-agent-canvas          examples/showcases/multi-agent-canvas
    archive_repo open-chatkit-studio              examples/showcases/chatkit-studio
}

archive_group_c() {
    echo ""
    echo "========== GROUP C: Remaining Repos (4) =========="
    echo ""
    archive_repo enterprise-brex-demo             examples/showcases/enterprise-brex
    archive_repo enterprise-runner-example        examples/starters/enterprise-runner
    archive_repo react-vite-built-in-agent        examples/starters/react-vite-agent
    archive_repo a2a-travel                       examples/showcases/a2a-travel
}

archive_group_d() {
    echo ""
    echo "========== GROUP D: Markus Ecker Forks (2) =========="
    echo ""
    archive_repo demo-spreadsheet                 examples/showcases/spreadsheet
    archive_repo demo-todo                        examples/showcases/todo
}

# ============================================================
# Main
# ============================================================

echo "Archive script starting..."
echo "Temp dir: $CLONE_DIR"
echo "Group filter: $GROUP_FILTER"
echo "Dry run: $DRY_RUN"
echo ""

case "$GROUP_FILTER" in
    A|a) archive_group_a ;;
    B|b) archive_group_b ;;
    C|c) archive_group_c ;;
    D|d) archive_group_d ;;
    all)
        archive_group_a
        archive_group_b
        archive_group_c
        archive_group_d
        ;;
    *) echo "Unknown group: $GROUP_FILTER"; exit 1 ;;
esac

echo ""
echo "========== SUMMARY =========="
echo "Archived: $ARCHIVED"
echo "Failed: $FAILED"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
    echo ""
    echo "FAILURES (${#FAILURES[@]}):"
    for f in "${FAILURES[@]}"; do
        echo "  - $f"
    done
    exit 1
fi
