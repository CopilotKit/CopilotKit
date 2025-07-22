#!/bin/bash
set -e

APP_NAME="$1"
AGENT_PORT="${2:-8000}"
UI_PORT="${3:-3000}"

if [ -z "$APP_NAME" ]; then
    echo "Usage: $0 <app-name> [agent-port] [ui-port]"
    echo "Example: $0 qa-native 8001 3001"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Starting $APP_NAME...${NC}"

# Determine app path
case "$APP_NAME" in
    research-canvas|travel)
        APP_PATH="../examples/coagents/$APP_NAME"
        UI_DIR="ui"
        ;;
    *)
        APP_PATH="example-apps/$APP_NAME"
        UI_DIR="frontend"
        ;;
esac

AGENT_PATH="$APP_PATH/agent-py"

# Check if paths exist
if [ ! -d "$AGENT_PATH" ]; then
    echo "❌ Agent directory not found: $AGENT_PATH"
    exit 1
fi

if [ ! -d "$APP_PATH/$UI_DIR" ]; then
    echo "❌ UI directory not found: $APP_PATH/$UI_DIR"
    exit 1
fi

echo -e "${YELLOW}📦 Installing dependencies...${NC}"

# Store absolute paths from current directory
SCRIPT_DIR="$(pwd)"
ABS_AGENT_PATH="$SCRIPT_DIR/$AGENT_PATH"
ABS_UI_PATH="$SCRIPT_DIR/$APP_PATH/$UI_DIR"

# Build CopilotKit packages
echo -e "${GREEN}📦 Building CopilotKit packages...${NC}"
cd ../CopilotKit
pnpm install --frozen-lockfile
pnpm run build
cd ../e2e

# Set up global package links
echo -e "${GREEN}🔗 Setting up global package links...${NC}"
copilotkit_path="../CopilotKit/packages"
if [[ ! -d "$copilotkit_path" ]]; then
    copilotkit_path="../../CopilotKit/packages"
fi

# Register all packages globally
for package in $(ls -d $copilotkit_path/* 2>/dev/null || true); do
    if [ -d "$package" ]; then
        echo "Registering $(basename "$package") globally"
        cd "$package"
        pnpm link --global
        cd - > /dev/null
    fi
done

# Install agent dependencies
cd "$ABS_AGENT_PATH"
echo "OPENAI_API_KEY=${OPENAI_API_KEY}" > .env
# Add special env vars for specific apps
case "$APP_NAME" in
    *research*|*canvas*)
        echo "TAVILY_API_KEY=${TAVILY_API_KEY}" >> .env
        ;;
    *travel*)
        echo "GOOGLE_MAPS_API_KEY=${GOOGLE_MAPS_API_KEY}" >> .env
        ;;
esac
uv sync

# Install UI dependencies and link CopilotKit packages
cd "$ABS_UI_PATH"
pnpm install

# Link all CopilotKit packages that exist in package.json
echo -e "${GREEN}🔗 Linking local packages to UI...${NC}"
for package in $(ls -d $copilotkit_path/* 2>/dev/null || true); do
    if [ -d "$package" ]; then
        package_name=$(basename "$package")
        # Check if package is in dependencies
        if grep -q "@copilotkit/$package_name" package.json 2>/dev/null; then
            pnpm link "@copilotkit/$package_name"
        fi
    fi
done

# Start both services
cd "$ABS_AGENT_PATH"
echo -e "${GREEN}🐍 Starting agent on port $AGENT_PORT...${NC}"
# Set PYTHONPATH to include local SDK
export PYTHONPATH="../../../sdk-python:${PYTHONPATH}"
PORT=$AGENT_PORT uv run demo &
AGENT_PID=$!

cd "$ABS_UI_PATH"
echo -e "${GREEN}⚛️  Starting UI on port $UI_PORT...${NC}"
# Override hardcoded port in package.json by using npx next directly
PORT=$UI_PORT npx next dev --port $UI_PORT &
UI_PID=$!

# Wait for processes
echo -e "${YELLOW}⏳ Services starting... (Press Ctrl+C to stop)${NC}"
wait 