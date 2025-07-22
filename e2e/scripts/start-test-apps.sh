#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
ENV_FILE="/tmp/copilotkit-urls.env"
WHITELIST_MAIN_EXAMPLES=("research-canvas" "travel")

show_help() {
    cat << EOF
Usage: $0 [OPTIONS] [APP_NAMES...]

Start CopilotKit apps and output URLs as environment variables.

OPTIONS:
    -h, --help          Show this help
    -e, --env FILE      Output env vars to file (default: $ENV_FILE)
    -l, --list          List available apps and exit
    --print-env         Print environment variables to stdout
    --all               Start all apps (default)

EXAMPLES:
    $0                           # Start all apps
    $0 research-canvas qa-text   # Start specific apps  
    $0 --list                    # Show available apps
    source <($0 --print-env)     # Load URLs into current shell
EOF
}

list_available_apps() {
    echo -e "${GREEN}📱 Available apps:${NC}"
    
    echo -e "${YELLOW}From e2e/example-apps/ (auto-included):${NC}"
    for app_dir in example-apps/*/; do
        if [ -d "$app_dir" ]; then
            local name=$(basename "$app_dir")
            local has_agent=false
            local has_ui=false
            [ -d "$app_dir/agent" ] || [ -d "$app_dir/agent-py" ] && has_agent=true
            [ -d "$app_dir/ui" ] || [ -d "$app_dir/frontend" ] && has_ui=true
            if $has_agent || $has_ui; then
                echo "  $name (agent=$has_agent ui=$has_ui)"
            fi
        fi
    done
    
    echo -e "${YELLOW}From examples/coagents/ (whitelist):${NC}"
    for app in "${WHITELIST_MAIN_EXAMPLES[@]}"; do
        local app_dir="../examples/coagents/$app"
        if [ -d "$app_dir" ]; then
            local has_agent=false
            local has_ui=false
            [ -d "$app_dir/agent" ] || [ -d "$app_dir/agent-py" ] && has_agent=true
            [ -d "$app_dir/ui" ] || [ -d "$app_dir/frontend" ] && has_ui=true
            if $has_agent || $has_ui; then
                echo "  $app (agent=$has_agent ui=$has_ui)"
            fi
        fi
    done
}

# Parse command line arguments
PRINT_ENV=false
REQUESTED_APPS=()
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -l|--list)
            list_available_apps
            exit 0
            ;;
        -e|--env)
            ENV_FILE="$2"
            shift 2
            ;;
        --print-env)
            PRINT_ENV=true
            shift
            ;;
        --all)
            # Default behavior
            shift
            ;;
        -*)
            echo "Unknown option $1"
            show_help
            exit 1
            ;;
        *)
            REQUESTED_APPS+=("$1")
            shift
            ;;
    esac
done

# Auto-discovery function
discover_apps() {
    local requested=("$@")
    local apps=()
    local agent_port=8001
    local ui_port=3001
    
    # Auto-include all apps from e2e/example-apps/
    for app_dir in example-apps/*/; do
        if [ -d "$app_dir" ]; then
            local name=$(basename "$app_dir")
            local has_agent=false
            local has_ui=false
            [ -d "$app_dir/agent" ] || [ -d "$app_dir/agent-py" ] && has_agent=true
            [ -d "$app_dir/ui" ] || [ -d "$app_dir/frontend" ] && has_ui=true
            
            if $has_agent || $has_ui; then
                # Check if specific apps requested
                if [ ${#requested[@]} -gt 0 ]; then
                    local include=false
                    for req in "${requested[@]}"; do
                        if [ "$req" = "$name" ]; then
                            include=true
                            break
                        fi
                    done
                    [ "$include" = false ] && continue
                fi
                
                apps+=("$name|$app_dir|$has_agent|$has_ui|$agent_port|$ui_port")
                ((agent_port++))
                ((ui_port++))
            fi
        fi
    done
    
    # Whitelist from examples/coagents/
    for app in "${WHITELIST_MAIN_EXAMPLES[@]}"; do
        local app_dir="../examples/coagents/$app"
        if [ -d "$app_dir" ]; then
            local has_agent=false
            local has_ui=false
            [ -d "$app_dir/agent" ] || [ -d "$app_dir/agent-py" ] && has_agent=true
            [ -d "$app_dir/ui" ] || [ -d "$app_dir/frontend" ] && has_ui=true
            
            if $has_agent || $has_ui; then
                # Check if specific apps requested
                if [ ${#requested[@]} -gt 0 ]; then
                    local include=false
                    for req in "${requested[@]}"; do
                        if [ "$req" = "$app" ]; then
                            include=true
                            break
                        fi
                    done
                    [ "$include" = false ] && continue
                fi
                
                apps+=("$app|$app_dir|$has_agent|$has_ui|$agent_port|$ui_port")
                ((agent_port++))
                ((ui_port++))
            fi
        fi
    done
    
    printf '%s\n' "${apps[@]}"
}

# Helper functions
get_ui_dir() {
    local app_dir=$1
    if [ -d "$app_dir/ui" ]; then
        echo "ui"
    elif [ -d "$app_dir/frontend" ]; then
        echo "frontend"
    fi
}

get_agent_dir() {
    local app_dir=$1
    if [ -d "$app_dir/agent" ]; then
        echo "agent"
    elif [ -d "$app_dir/agent-py" ]; then
        echo "agent-py"
    fi
}

get_agent_module() {
    local agent_dir=$1
    
    # Try to find demo.py files and infer module
    local demo_file=$(find "$agent_dir" -name "demo.py" | head -n 1)
    if [ -n "$demo_file" ]; then
        # Convert path to module name
        local rel_path=$(realpath --relative-to="$agent_dir" "$demo_file")
        local module=$(echo "$rel_path" | sed 's/\.py$//' | sed 's/\//./g')
        echo "$module"
        return
    fi
    
    # Fallback: assume directory name + .demo
    local dir_name=$(basename "$agent_dir")
    echo "${dir_name}.demo"
}

wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    
    echo -e "${YELLOW}⏳ Waiting for ${name}...${NC}"
    for i in $(seq 1 $max_attempts); do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ ${name} ready!${NC}"
            return 0
        fi
        sleep 2
    done
    
    echo -e "${RED}❌ ${name} failed to start${NC}"
    return 1
}

cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up...${NC}"
    # Kill processes on our port ranges
    for port in {8001..8020} {3001..3020}; do
        lsof -ti:$port | xargs kill -9 2>/dev/null || true
    done
    rm -f /tmp/copilotkit-*.pid
}

trap cleanup EXIT INT TERM

# Output environment variables
output_env_vars() {
    local target="$1"  # "file" or "stdout"
    local apps=("${@:2}")
    
    for app_info in "${apps[@]}"; do
        IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
        
        if [ "$has_ui" = "true" ]; then
            # Convert app name to valid env var name (uppercase, replace hyphens)
            local env_name=$(echo "$name" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
            
            local ui_var="${env_name}_URL"
            local agent_var="${env_name}_AGENT_URL"
            
            if [ "$target" = "stdout" ]; then
                echo "export $ui_var=\"http://localhost:$ui_port\""
                [ "$has_agent" = "true" ] && echo "export $agent_var=\"http://localhost:$agent_port\""
            else
                echo "$ui_var=http://localhost:$ui_port" >> "$target"
                [ "$has_agent" = "true" ] && echo "$agent_var=http://localhost:$agent_port" >> "$target"
            fi
        fi
    done
}

# If --print-env, just output and exit
if [ "$PRINT_ENV" = "true" ]; then
    # Use while loop instead of mapfile for better compatibility
    discovered_apps=()
    while IFS= read -r line; do
        discovered_apps+=("$line")
    done < <(discover_apps "${REQUESTED_APPS[@]}")
    output_env_vars "stdout" "${discovered_apps[@]}"
    exit 0
fi

# Check environment
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}❌ OPENAI_API_KEY required${NC}"
    exit 1
fi

# Discover apps to start
discovered_apps=()
while IFS= read -r line; do
    discovered_apps+=("$line")
done < <(discover_apps "${REQUESTED_APPS[@]}")

if [ ${#discovered_apps[@]} -eq 0 ]; then
    echo -e "${RED}❌ No apps found to start${NC}"
    if [ ${#REQUESTED_APPS[@]} -gt 0 ]; then
        echo "Requested: ${REQUESTED_APPS[*]}"
        echo "Run '$0 --list' to see available apps"
    fi
    exit 1
fi

echo -e "${GREEN}🚀 Starting ${#discovered_apps[@]} apps...${NC}"
for app_info in "${discovered_apps[@]}"; do
    IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
    echo "  $name: agent=$has_agent ui=$has_ui (ports: $agent_port/$ui_port)"
done

echo -e "${GREEN}📦 Building CopilotKit packages...${NC}"
cd ../CopilotKit
pnpm install --frozen-lockfile
pnpm run build
cd ../e2e

echo -e "${GREEN}🔗 Linking local packages...${NC}"
for app_info in "${discovered_apps[@]}"; do
    IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
    
    if [ "$has_ui" = "true" ]; then
        local ui_dir_name=$(get_ui_dir "$path")
        local ui_path="$path/$ui_dir_name"
        
        if [ -d "$ui_path" ]; then
            echo "Linking packages for $name"
            cd "$ui_path"
            pnpm install
            
            # Auto-detect CopilotKit packages path
            local copilotkit_path="../../../CopilotKit/packages"
            if [[ ! -d "$copilotkit_path" ]]; then
                copilotkit_path="../../../../CopilotKit/packages"
            fi
            
            for package in $(ls -d $copilotkit_path/* 2>/dev/null || true); do
                pnpm link "$package"
            done
            cd - > /dev/null
        fi
    fi
done

echo -e "${GREEN}🐍 Starting agents...${NC}"
for app_info in "${discovered_apps[@]}"; do
    IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
    
    if [ "$has_agent" = "true" ]; then
        local agent_dir_name=$(get_agent_dir "$path")
        local agent_path="$path/$agent_dir_name"
        
        if [ -d "$agent_path" ]; then
            echo "Starting $name agent on port $agent_port"
            cd "$agent_path"
            uv sync
            echo "OPENAI_API_KEY=${OPENAI_API_KEY}" > .env
            
            # Add special env vars for specific apps
            case "$name" in
                *research*|*canvas*)
                    echo "TAVILY_API_KEY=${TAVILY_API_KEY}" >> .env
                    ;;
                *travel*)
                    echo "GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}" >> .env
                    ;;
            esac
            
            local module=$(get_agent_module "$agent_path")
            echo "Using module: $module"
            
            # Set PYTHONPATH to include local SDK
            export PYTHONPATH="../../../sdk-python:${PYTHONPATH}"
            
            PORT=$agent_port uv run python -m $module &
            echo $! > /tmp/copilotkit-$name-agent.pid
            cd - > /dev/null
        fi
    fi
done

echo -e "${GREEN}⏳ Waiting for agents...${NC}"
for app_info in "${discovered_apps[@]}"; do
    IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
    
    if [ "$has_agent" = "true" ]; then
        wait_for_service "http://localhost:$agent_port/docs" "$name agent"
    fi
done

echo -e "${GREEN}⚛️  Starting UIs...${NC}"
for app_info in "${discovered_apps[@]}"; do
    IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
    
    if [ "$has_ui" = "true" ]; then
        local ui_dir_name=$(get_ui_dir "$path")
        local ui_path="$path/$ui_dir_name"
        
        if [ -d "$ui_path" ]; then
            echo "Starting $name UI on port $ui_port"
            cd "$ui_path"
            echo "OPENAI_API_KEY=${OPENAI_API_KEY}" > .env
            
            PORT=$ui_port pnpm run dev &
            echo $! > /tmp/copilotkit-$name-ui.pid
            cd - > /dev/null
        fi
    fi
done

echo -e "${GREEN}⏳ Waiting for UIs...${NC}"
for app_info in "${discovered_apps[@]}"; do
    IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
    
    if [ "$has_ui" = "true" ]; then
        wait_for_service "http://localhost:$ui_port" "$name UI"
    fi
done

echo -e "${GREEN}🎉 All services ready!${NC}"

# Write environment file
echo -e "${GREEN}📝 Writing URLs to $ENV_FILE${NC}"
echo "# CopilotKit App URLs - Generated at $(date)" > "$ENV_FILE"
output_env_vars "$ENV_FILE" "${discovered_apps[@]}"

echo -e "${GREEN}🌐 Available URLs:${NC}"
for app_info in "${discovered_apps[@]}"; do
    IFS='|' read -r name path has_agent has_ui agent_port ui_port <<< "$app_info"
    if [ "$has_ui" = "true" ]; then
        local env_name=$(echo "$name" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
        printf "  %-20s http://localhost:%s (${env_name}_URL)\n" "$name:" "$ui_port"
    fi
done

echo ""
echo -e "${YELLOW}💡 Load URLs: source $ENV_FILE${NC}"
echo -e "${YELLOW}💡 Run tests: pnpm test${NC}"
echo -e "${YELLOW}💡 Press Ctrl+C to stop all services${NC}"

# Keep running
wait 