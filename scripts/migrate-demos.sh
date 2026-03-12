#!/usr/bin/env bash
set -euo pipefail

# Migration script: shallow clone demo repos → copy into examples/
# Usage: ./scripts/migrate-demos.sh [--group A|B|C|D|all] [--dry-run]

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLONE_DIR="$(mktemp -d)"
trap 'rm -rf "$CLONE_DIR"' EXIT

GROUP="${1:---group}"
GROUP_FILTER="${2:-all}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --group) GROUP_FILTER="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        *) shift ;;
    esac
done

# Track warnings for post-run summary
WARNINGS=()
MIGRATED=0
FAILED=0

warn() { WARNINGS+=("$1"); echo "  WARNING: $1"; }

migrate_repo() {
    local repo="$1"
    local target_path="$2"
    local branch="${3:-}"
    local full_target="$REPO_ROOT/$target_path"

    echo "==> Migrating $repo → $target_path"

    if [[ -d "$full_target" ]]; then
        echo "  SKIP: $full_target already exists"
        return 0
    fi

    # Step 1: Shallow clone
    local clone_dest="$CLONE_DIR/$repo"
    rm -rf "$clone_dest"

    local clone_args=(--depth 1)
    if [[ -n "$branch" ]]; then
        clone_args+=(--branch "$branch")
    fi

    if ! git clone "${clone_args[@]}" "https://github.com/CopilotKit/${repo}.git" "$clone_dest" 2>/dev/null; then
        echo "  FAILED: Could not clone $repo"
        ((FAILED++))
        return 1
    fi

    # Step 2: Cleanup
    rm -rf "$clone_dest/.git"
    rm -rf "$clone_dest/.github"
    rm -f  "$clone_dest/renovate.json"
    rm -f  "$clone_dest/netlify.toml"
    rm -f  "$clone_dest/_redirects"
    rm -f  "$clone_dest/_headers"
    find "$clone_dest" -type d -name "node_modules" -exec rm -rf {} + 2>/dev/null || true

    # Remove .env files but keep .env.example
    find "$clone_dest" -name ".env" -not -name ".env.example" -delete 2>/dev/null || true
    # Also remove .env.local, .env.development.local, etc. but not .env.example
    find "$clone_dest" -name ".env.*" -not -name ".env.example" -not -name ".env.*.example" -delete 2>/dev/null || true

    # Step 3: Scan for large files not covered by LFS
    while IFS= read -r -d '' f; do
        local ext="${f##*.}"
        local ext_lower
        ext_lower=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
        case "$ext_lower" in
            gif|jpg|jpeg|png|pdf|mp4|webm|svg) ;; # Covered by .gitattributes
            *) warn "$target_path: Large file not LFS-tracked: ${f#$clone_dest/} ($(du -h "$f" | cut -f1))" ;;
        esac
    done < <(find "$clone_dest" -type f -size +1M -print0 2>/dev/null)

    if [[ $DRY_RUN -eq 1 ]]; then
        echo "  DRY RUN: Would copy to $full_target"
        ((MIGRATED++))
        rm -rf "$clone_dest"
        return 0
    fi

    # Step 4: Copy to target
    mkdir -p "$(dirname "$full_target")"
    cp -a "$clone_dest" "$full_target"

    # Step 5: Clean up clone
    rm -rf "$clone_dest"
    ((MIGRATED++))
    echo "  OK: $target_path"
}

# ============================================================
# MANIFEST: All 73 repos organized by group
# Format: migrate_repo <github-repo-name> <target-path> [branch]
# ============================================================

migrate_group_a() {
    echo ""
    echo "========== GROUP A: Demo Team Repos (25) =========="
    echo ""
    migrate_repo with-langgraph-python           examples/integrations/langgraph-python
    migrate_repo with-langgraph-js               examples/integrations/langgraph-js
    migrate_repo with-langgraph-fastapi           examples/integrations/langgraph-fastapi
    migrate_repo with-mastra                      examples/integrations/mastra
    migrate_repo with-crewai-flows                examples/integrations/crewai-flows
    migrate_repo with-llamaindex                  examples/integrations/llamaindex
    migrate_repo with-pydantic-ai                 examples/integrations/pydantic-ai
    migrate_repo with-microsoft-agent-framework-python examples/integrations/ms-agent-framework-python
    migrate_repo with-microsoft-agent-framework-dotnet examples/integrations/ms-agent-framework-dotnet
    migrate_repo with-strands-python              examples/integrations/strands-python
    migrate_repo with-mcp-apps                    examples/integrations/mcp-apps
    migrate_repo with-adk                         examples/integrations/adk
    migrate_repo with-agent-spec                  examples/integrations/agent-spec
    migrate_repo with-a2a-a2ui                    examples/integrations/a2a-a2ui
    migrate_repo demo-banking                     examples/showcases/banking
    migrate_repo demo-presentation                examples/showcases/presentation
    migrate_repo example-textarea                 examples/starters/textarea
    migrate_repo example-todos-app                examples/starters/todos-app
    migrate_repo deep-agents-demo                 examples/showcases/deep-agents
    migrate_repo deep-agents-job-search-assistant examples/showcases/deep-agents-job-search
    migrate_repo generative-ui                    examples/showcases/generative-ui
    migrate_repo generative-ui-playground         examples/showcases/generative-ui-playground
    migrate_repo mcp-apps-demo                    examples/showcases/mcp-apps
    migrate_repo open-research-ANA                examples/showcases/research-canvas
    migrate_repo vnext_experimental_angular_demo  examples/experiments/angular-vnext
}

migrate_group_b() {
    echo ""
    echo "========== GROUP B: Additional Repos (34) =========="
    echo ""
    # Integration starters
    migrate_repo with-agno                        examples/integrations/agno
    migrate_repo with-crewai-crews                examples/integrations/crewai-crews
    migrate_repo with-a2a-middleware               examples/integrations/a2a-middleware

    # Canvas demos
    migrate_repo canvas-with-langgraph-python      examples/canvas/langgraph-python
    migrate_repo canvas-with-llamaindex            examples/canvas/llamaindex
    migrate_repo canvas-with-llamaindex-composio   examples/canvas/llamaindex-composio
    migrate_repo canvas-with-pydantic-ai           examples/canvas/pydantic-ai
    migrate_repo canvas-with-mastra                examples/canvas/mastra

    # Feature demos
    migrate_repo crew_ai_enterprise_demo          examples/showcases/crewai-enterprise
    migrate_repo copilotkit-mcp-demo              examples/showcases/mcp-demo
    migrate_repo agui-demo                        examples/showcases/agui
    migrate_repo strands-file-analyzer-demo       examples/showcases/strands-file-analyzer
    migrate_repo microsoft-kanban-demo            examples/showcases/microsoft-kanban
    migrate_repo 1.50-demo                        examples/experiments/v1.50
    migrate_repo multi-page-demo                  examples/showcases/multi-page
    migrate_repo demo-crm                         examples/showcases/crm
    migrate_repo demo-campaign-manager            examples/showcases/campaign-manager
    migrate_repo demo-chat-sso                    examples/showcases/chat-sso
    migrate_repo orca-CopilotKit-demo             examples/showcases/orca
    migrate_repo private_a2ui_demo                examples/experiments/a2ui-private

    # Starters and showcases
    migrate_repo coagents-starter-langgraph       examples/starters/coagents-langgraph
    migrate_repo coagents-starter-crewai-flows    examples/starters/coagents-crewai-flows
    migrate_repo pydantic-ai-todos                examples/showcases/pydantic-ai-todos
    migrate_repo scene-creator-copilot            examples/showcases/scene-creator
    migrate_repo open-gemini-canvas               examples/canvas/gemini
    migrate_repo llamaindex-hitl-guide-example    examples/starters/llamaindex-hitl
    migrate_repo llamaindex-composio-hackathon-sample examples/experiments/llamaindex-composio-hackathon
    migrate_repo adk-generative-dashboard         examples/showcases/adk-dashboard
    migrate_repo mastra-pm-canvas                 examples/canvas/mastra-pm
    migrate_repo vnext-with-pydantic              examples/experiments/vnext-pydantic
    migrate_repo langgraph-js-support-agents      examples/showcases/langgraph-js-support-agents
    migrate_repo open-multi-agent-canvas          examples/showcases/multi-agent-canvas
    migrate_repo open-chatkit-studio              examples/showcases/chatkit-studio
    migrate_repo copilotkit-jupyter-notebook       examples/experiments/jupyter-notebook
}

migrate_group_c() {
    echo ""
    echo "========== GROUP C: Borderline Repos (12) =========="
    echo ""
    migrate_repo deep-agent-cpk-experiments       examples/experiments/deep-agent-experiments
    migrate_repo crew-flow-ent-dojo               examples/experiments/crew-flow-ent-dojo
    migrate_repo crew-flow-cpk-temp               examples/experiments/crew-flow-cpk-temp
    migrate_repo ag2-feature-viewer               examples/experiments/ag2-feature-viewer
    migrate_repo enterprise-brex-demo             examples/showcases/enterprise-brex
    migrate_repo enterprise-runner-example        examples/starters/enterprise-runner
    migrate_repo ag-ui-expo-playground            examples/experiments/expo-playground
    migrate_repo react-vite-built-in-agent        examples/starters/react-vite-agent
    migrate_repo find-the-bug                     examples/experiments/find-the-bug
    migrate_repo autotale-ai-web-ui               examples/showcases/autotale
    migrate_repo cuddly-fortnight                 examples/experiments/cuddly-fortnight
    migrate_repo a2a-travel                       examples/showcases/a2a-travel
}

migrate_group_d() {
    echo ""
    echo "========== GROUP D: Markus Ecker Forks (2) =========="
    echo ""
    migrate_repo demo-spreadsheet                 examples/showcases/spreadsheet
    migrate_repo demo-todo                        examples/showcases/todo
}

# ============================================================
# Main
# ============================================================

echo "Migration script starting..."
echo "Repo root: $REPO_ROOT"
echo "Temp dir: $CLONE_DIR"
echo "Group filter: $GROUP_FILTER"
echo "Dry run: $DRY_RUN"
echo ""

case "$GROUP_FILTER" in
    A|a) migrate_group_a ;;
    B|b) migrate_group_b ;;
    C|c) migrate_group_c ;;
    D|d) migrate_group_d ;;
    all)
        migrate_group_a
        migrate_group_b
        migrate_group_c
        migrate_group_d
        ;;
    *) echo "Unknown group: $GROUP_FILTER"; exit 1 ;;
esac

echo ""
echo "========== SUMMARY =========="
echo "Migrated: $MIGRATED"
echo "Failed: $FAILED"

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo ""
    echo "WARNINGS (${#WARNINGS[@]}):"
    for w in "${WARNINGS[@]}"; do
        echo "  - $w"
    done
fi
