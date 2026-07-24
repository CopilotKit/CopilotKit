#!/usr/bin/env bash
# deploy-langgraph.sh — Deploy CopilotKit + LangGraph on AWS AgentCore
# Usage: ./deploy-langgraph.sh [--skip-frontend] [--skip-backend]
# Stack: <stack_name_base>-lg  (isolated from deploy-strands.sh)
# Using Terraform instead? See infra-terraform/README.md
set -euo pipefail
set +a
set +x
export -n CPK_INTELLIGENCE_API_KEY
export -n COPILOTKIT_LICENSE_TOKEN

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

if [ "$SKIP_BACKEND" = false ]; then
  if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "ERROR: $SCRIPT_DIR/.env is required. Copy .env.example and add your managed project credentials."
    exit 1
  fi

  INTELLIGENCE_API_URL_OVERRIDE_SET=false
  if [ "${INTELLIGENCE_API_URL+x}" = x ]; then
    INTELLIGENCE_API_URL_OVERRIDE="$INTELLIGENCE_API_URL"
    INTELLIGENCE_API_URL_OVERRIDE_SET=true
  fi
  INTELLIGENCE_GATEWAY_WS_URL_OVERRIDE_SET=false
  if [ "${INTELLIGENCE_GATEWAY_WS_URL+x}" = x ]; then
    INTELLIGENCE_GATEWAY_WS_URL_OVERRIDE="$INTELLIGENCE_GATEWAY_WS_URL"
    INTELLIGENCE_GATEWAY_WS_URL_OVERRIDE_SET=true
  fi

  source "$SCRIPT_DIR/.env"
  set +a
  set +x
  if [ "$INTELLIGENCE_API_URL_OVERRIDE_SET" = true ]; then
    export INTELLIGENCE_API_URL="$INTELLIGENCE_API_URL_OVERRIDE"
  fi
  if [ "$INTELLIGENCE_GATEWAY_WS_URL_OVERRIDE_SET" = true ]; then
    export INTELLIGENCE_GATEWAY_WS_URL="$INTELLIGENCE_GATEWAY_WS_URL_OVERRIDE"
  fi
  : "${CPK_INTELLIGENCE_API_KEY:?CPK_INTELLIGENCE_API_KEY is required in .env}"
  : "${COPILOTKIT_LICENSE_TOKEN:?COPILOTKIT_LICENSE_TOKEN is required by the pinned SDK in .env}"
  export -n CPK_INTELLIGENCE_API_KEY
  export -n COPILOTKIT_LICENSE_TOKEN
  export INTELLIGENCE_API_URL="${INTELLIGENCE_API_URL:-}"
  export INTELLIGENCE_GATEWAY_WS_URL="${INTELLIGENCE_GATEWAY_WS_URL:-}"
fi
export CPK_TELEMETRY_ID="${CPK_TELEMETRY_ID:-}"

echo "── CopilotKit + AWS AgentCore (LangGraph) ──────────────────────────────"

# ── Preflight checks ──────────────────────────────────────────────────────────
check_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 is required but not installed."; exit 1; }
}
require_remote_endpoint() {
  local name="$1"
  local value="$2"
  local example="$3"
  if [[ -z "$value" || "$value" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*://(localhost|127\.0\.0\.1)([:/]|$) ]]; then
    echo "ERROR: $name must be a non-local endpoint reachable from AWS (for example, $example). Set it in .env or prefix the deploy command."
    exit 1
  fi
}
check_command aws
check_command python3
if [ "$SKIP_BACKEND" = false ]; then
  require_remote_endpoint INTELLIGENCE_API_URL "${INTELLIGENCE_API_URL:-}" "https://intelligence.example.com"
  require_remote_endpoint INTELLIGENCE_GATEWAY_WS_URL "${INTELLIGENCE_GATEWAY_WS_URL:-}" "wss://gateway.example.com"
  check_command node
  check_command docker
fi

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
  unset CPK_INTELLIGENCE_API_KEY
  unset COPILOTKIT_LICENSE_TOKEN
  echo "⚡ Skipping backend deploy (--skip-backend)"
else
  # Materialize backend credentials only while backend resources are deployed.
  CPK_INTELLIGENCE_API_KEY_SECRET_NAME=$(python3 -c "import re; c=open('$CONFIG').read(); print(re.search(r'^copilotkit_intelligence_api_key_secret_name:\s*([^#\s]+)', c, re.MULTILINE).group(1))")
  if aws secretsmanager describe-secret --secret-id "$CPK_INTELLIGENCE_API_KEY_SECRET_NAME" >/dev/null 2>&1; then
    CPK_INTELLIGENCE_API_KEY_SECRET_VERSION_ID=$(printf '%s' "$CPK_INTELLIGENCE_API_KEY" | aws secretsmanager put-secret-value --secret-id "$CPK_INTELLIGENCE_API_KEY_SECRET_NAME" --secret-string file:///dev/stdin --query VersionId --output text)
  else
    CPK_INTELLIGENCE_API_KEY_SECRET_VERSION_ID=$(printf '%s' "$CPK_INTELLIGENCE_API_KEY" | aws secretsmanager create-secret --name "$CPK_INTELLIGENCE_API_KEY_SECRET_NAME" --secret-string file:///dev/stdin --query VersionId --output text)
  fi
  unset CPK_INTELLIGENCE_API_KEY

  COPILOTKIT_LICENSE_TOKEN_SECRET_NAME=$(python3 -c "import re; c=open('$CONFIG').read(); print(re.search(r'^copilotkit_license_token_secret_name:\s*([^#\s]+)', c, re.MULTILINE).group(1))")
  if aws secretsmanager describe-secret --secret-id "$COPILOTKIT_LICENSE_TOKEN_SECRET_NAME" >/dev/null 2>&1; then
    COPILOTKIT_LICENSE_TOKEN_SECRET_VERSION_ID=$(printf '%s' "$COPILOTKIT_LICENSE_TOKEN" | aws secretsmanager put-secret-value --secret-id "$COPILOTKIT_LICENSE_TOKEN_SECRET_NAME" --secret-string file:///dev/stdin --query VersionId --output text)
  else
    COPILOTKIT_LICENSE_TOKEN_SECRET_VERSION_ID=$(printf '%s' "$COPILOTKIT_LICENSE_TOKEN" | aws secretsmanager create-secret --name "$COPILOTKIT_LICENSE_TOKEN_SECRET_NAME" --secret-string file:///dev/stdin --query VersionId --output text)
  fi
  unset COPILOTKIT_LICENSE_TOKEN

  : "${CPK_INTELLIGENCE_API_KEY_SECRET_VERSION_ID:?Secrets Manager did not return a managed key version ID}"
  : "${COPILOTKIT_LICENSE_TOKEN_SECRET_VERSION_ID:?Secrets Manager did not return a license token version ID}"
  export CPK_INTELLIGENCE_API_KEY_SECRET_VERSION_ID
  export COPILOTKIT_LICENSE_TOKEN_SECRET_VERSION_ID
  echo "✓ Managed Intelligence credentials stored in Secrets Manager"

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
