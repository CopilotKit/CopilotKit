#!/bin/bash

# CoAgents Starter - Start Script
# This script helps you run the CoAgents starter example

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_usage() {
    echo -e "${BLUE}CoAgents Starter - Start Script${NC}"
    echo ""
    echo "Usage: $0 [OPTIONS] [AGENT_TYPE]"
    echo ""
    echo "AGENT_TYPE:"
    echo "  python    - Run Python agent with UI"
    echo "  js        - Run JavaScript agent with UI"
    echo "  ui-only   - Run UI only (for external agents)"
    echo ""
    echo "OPTIONS:"
    echo "  --install   - Install dependencies before starting"
    echo "  --help      - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 python              # Run Python agent + UI"
    echo "  $0 js --install        # Install deps and run JS agent + UI"
    echo "  $0 ui-only             # Run UI only"
    echo ""
}

install_deps() {
    echo -e "${YELLOW}Installing dependencies...${NC}"
    
    # Install UI dependencies
    echo -e "${BLUE}Installing UI dependencies...${NC}"
    cd ui && pnpm install && cd ..
    
    if [[ "$1" == "python" ]]; then
        echo -e "${BLUE}Installing Python agent dependencies...${NC}"
        cd agent-py && poetry install && cd ..
    elif [[ "$1" == "js" ]]; then
        echo -e "${BLUE}Installing JavaScript agent dependencies...${NC}"
        cd agent-js && pnpm install && cd ..
    fi
    
    echo -e "${GREEN}Dependencies installed successfully!${NC}"
}

check_env_files() {
    local missing_files=()
    
    if [[ "$1" == "python" ]] && [[ ! -f "agent-py/.env" ]]; then
        missing_files+=("agent-py/.env")
    fi
    
    if [[ "$1" == "js" ]] && [[ ! -f "agent-js/.env" ]]; then
        missing_files+=("agent-js/.env")
    fi
    
    if [[ ! -f "ui/.env.local" ]]; then
        missing_files+=("ui/.env.local")
    fi
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        echo -e "${RED}Missing environment files:${NC}"
        for file in "${missing_files[@]}"; do
            echo -e "  ${RED}✗${NC} $file"
        done
        echo ""
        echo -e "${YELLOW}Please create the missing .env files with your OpenAI API key:${NC}"
        echo "OPENAI_API_KEY=your_api_key_here"
        echo ""
        exit 1
    fi
}

start_python_agent() {
    echo -e "${BLUE}Starting Python agent...${NC}"
    check_env_files "python"
    
    # Ensure dependencies are installed
    echo -e "${BLUE}Ensuring Python dependencies are installed...${NC}"
    cd agent-py
    poetry install
    
    # Start Python agent in background
    poetry run langgraph dev --host 0.0.0.0 --port 8000 &
    AGENT_PID=$!
    cd ..
    
    # Wait a moment for agent to start
    sleep 3
    
    # Start UI
    echo -e "${BLUE}Starting UI...${NC}"
    cd ui
    pnpm install
    pnpm run dev &
    UI_PID=$!
    cd ..
    
    echo -e "${GREEN}✓ Python agent running on http://localhost:8000${NC}"
    echo -e "${GREEN}✓ UI running on http://localhost:3000${NC}"
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    
    # Wait for interrupt
    trap 'kill $AGENT_PID $UI_PID 2>/dev/null; exit' INT
    wait
}

start_js_agent() {
    echo -e "${BLUE}Starting JavaScript agent...${NC}"
    check_env_files "js"
    
    # Ensure dependencies are installed
    echo -e "${BLUE}Ensuring JavaScript dependencies are installed...${NC}"
    cd agent-js
    pnpm install
    
    # Start JS agent in background
    pnpm run dev &
    AGENT_PID=$!
    cd ..
    
    # Wait a moment for agent to start
    sleep 3
    
    # Start UI
    echo -e "${BLUE}Starting UI...${NC}"
    cd ui
    pnpm install
    pnpm run dev &
    UI_PID=$!
    cd ..
    
    echo -e "${GREEN}✓ JavaScript agent running on http://localhost:8123${NC}"
    echo -e "${GREEN}✓ UI running on http://localhost:3000${NC}"
    echo ""
    echo -e "${YELLOW}Note: Make sure to uncomment the JS agent configuration in ui/app/api/copilotkit/route.ts${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    
    # Wait for interrupt
    trap 'kill $AGENT_PID $UI_PID 2>/dev/null; exit' INT
    wait
}

start_ui_only() {
    echo -e "${BLUE}Starting UI only...${NC}"
    check_env_files "ui-only"
    
    # Ensure UI dependencies are installed
    echo -e "${BLUE}Ensuring UI dependencies are installed...${NC}"
    cd ui
    pnpm install
    
    pnpm run dev &
    UI_PID=$!
    cd ..
    
    echo -e "${GREEN}✓ UI running on http://localhost:3000${NC}"
    echo -e "${YELLOW}Connect your external agent to the appropriate endpoint${NC}"
    echo -e "${YELLOW}Press Ctrl+C to stop the UI${NC}"
    
    # Wait for interrupt
    trap 'kill $UI_PID 2>/dev/null; exit' INT
    wait
}

# Parse arguments
INSTALL_DEPS=false
AGENT_TYPE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --install)
            INSTALL_DEPS=true
            shift
            ;;
        --help)
            print_usage
            exit 0
            ;;
        python|js|ui-only)
            AGENT_TYPE="$1"
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

# Default to python if no agent type specified
if [[ -z "$AGENT_TYPE" ]]; then
    AGENT_TYPE="python"
fi

# Install dependencies if requested
if [[ "$INSTALL_DEPS" == true ]]; then
    install_deps "$AGENT_TYPE"
fi

# Start the appropriate services
case $AGENT_TYPE in
    python)
        start_python_agent
        ;;
    js)
        start_js_agent
        ;;
    ui-only)
        start_ui_only
        ;;
    *)
        echo -e "${RED}Invalid agent type: $AGENT_TYPE${NC}"
        print_usage
        exit 1
        ;;
esac