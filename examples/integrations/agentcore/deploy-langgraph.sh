#!/usr/bin/env bash
# deploy-langgraph.sh — Deploy CopilotKit + LangGraph on AWS AgentCore
# Usage: ./deploy-langgraph.sh [--skip-frontend] [--skip-backend]
# Stack: <stack_name_base>-lg  (isolated from deploy-strands.sh)
# Using Terraform instead? See infra-terraform/README.md
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERN="langgraph-single-agent"
SUFFIX="-lg"
CONFIG="$SCRIPT_DIR/config.yaml"
CDK_DIR="$SCRIPT_DIR/infra-cdk"
SKIP_FRONTEND=false
SKIP_BACKEND=false

for arg in "$@"; do
  [[ "$arg" == "--skip-frontend" ]] && SKIP_FRONTEND=true
  [[ "$arg" == "--skip-backend" ]] && SKIP_BACKEND=true
done

echo "── CopilotKit + AWS AgentCore (LangGraph) ──────────────────────────────"

# ── Preflight checks ──────────────────────────────────────────────────────────
check_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 is required but not installed."; exit 1; }
}
check_command aws
check_command node
check_command python3
check_command docker

python3 -c "import sys; assert sys.version_info >= (3,8), 'Python 3.8+ required'" || exit 1
aws sts get-caller-identity --query "Account" --output text >/dev/null 2>&1 || \
  { echo "ERROR: AWS credentials not configured. Run: aws configure"; exit 1; }

echo "✓ Preflight checks passed"

# ── Patch config.yaml (pattern + stack name suffix) ──────────────────────────
python3 - "$CONFIG" "$PATTERN" "$SUFFIX" <<'PYEOF'
import re, sys
config_path, pattern, suffix = sys.argv[1], sys.argv[2], sys.argv[3]
with open(config_path) as f:
    content = f.read()
# Patch pattern
content = re.sub(r"(pattern:\s*)[\w-]+", r"\g<1>" + pattern, content)
# Patch stack_name_base: strip any existing -lg/-st suffix, append this script's suffix
def add_suffix(m):
    base = re.sub(r"-(lg|st)$", "", m.group(1))
    return f"stack_name_base: {base}{suffix}"
content = re.sub(r"stack_name_base:\s*([\w-]+)", add_suffix, content)
with open(config_path, "w") as f:
    f.write(content)
# Read back the final stack name for display
stack = re.search(r"stack_name_base:\s*([\w-]+)", content).group(1)
print(f"✓ config.yaml → pattern: {pattern}, stack: {stack}")
PYEOF

# ── CDK deploy ───────────────────────────────────────────────────────────────
if [ "$SKIP_BACKEND" = true ]; then
  echo "⚡ Skipping backend deploy (--skip-backend)"
else
  echo "Deploying infrastructure (this takes ~10–15 min on first run)..."
  cd "$CDK_DIR"
  npm install --silent
  npx cdk@latest deploy --all --require-approval never --output "${SCRIPT_DIR}/cdk.out${SUFFIX}"
  cd "$SCRIPT_DIR"
  echo "✓ Infrastructure deployed"
fi

# ── Frontend deploy ───────────────────────────────────────────────────────────
if [ "$SKIP_FRONTEND" = true ]; then
  echo "⚡ Skipping frontend deploy (--skip-frontend)"
else
  STACK_NAME=$(python3 -c "import re; c=open('$CONFIG').read(); print(re.search(r'stack_name_base:\s*([\w-]+)', c).group(1))")
  echo "Deploying frontend for stack: $STACK_NAME"
  python3 scripts/deploy-frontend.py "$STACK_NAME"
fi
echo ""
echo "✓ Done!"
