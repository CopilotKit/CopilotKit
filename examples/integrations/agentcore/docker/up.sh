#!/usr/bin/env bash
# Convenience wrapper — auto-fills .env with stack outputs, generates a local
# aws-exports.json pointing at localhost, then runs docker compose.
#
# Usage: ./up.sh [--build]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/../config.yaml"
ENV_FILE="$SCRIPT_DIR/.env"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: .env not found. Run: cp .env.example .env"; exit 1; }

# Read AGENT from .env
AGENT=$(grep "^AGENT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "strands")
AGENT="${AGENT:-strands}"

# Derive stack name from config.yaml
BASE=$(python3 -c "
import re, yaml
cfg = yaml.safe_load(open('$CONFIG'))
print(re.sub(r'-(lg|st)$', '', cfg['stack_name_base']))
")
SUFFIX="st" && [[ "$AGENT" == "langgraph" ]] && SUFFIX="lg"
STACK_NAME="${BASE}-${SUFFIX}"

echo "Agent: $AGENT  |  Resolving stack: $STACK_NAME..."

OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs" \
  --output json)

python3 - "$OUTPUTS" "$STACK_NAME" "$ENV_FILE" "$SCRIPT_DIR/../frontend/public" "$AGENT" <<'PYEOF'
import json, os, sys, re

outputs_json, stack_name, env_file, public_dir, agent = sys.argv[1:]
outputs = {o["OutputKey"]: o["OutputValue"] for o in json.loads(outputs_json)}

# Patch STACK_NAME and MEMORY_ID into .env
memory_arn = outputs.get("MemoryArn", "")
memory_id = memory_arn.split("/")[-1] if "/" in memory_arn else memory_arn

with open(env_file) as f:
    content = f.read()
for key, val in [("STACK_NAME", stack_name), ("MEMORY_ID", memory_id)]:
    if re.search(rf"^{key}=", content, re.MULTILINE):
        content = re.sub(rf"^{key}=.*", f"{key}={val}", content, flags=re.MULTILINE)
    else:
        content += f"\n{key}={val}"
with open(env_file, "w") as f:
    f.write(content)

# Generate local aws-exports.json pointing at localhost
pool_id = outputs.get("CognitoUserPoolId", "")
client_id = outputs.get("CognitoClientId", "")
runtime_arn = outputs.get("RuntimeArn", "")
pattern = "langgraph-single-agent" if agent == "langgraph" else "strands-single-agent"

aws_exports = {
    "authority": f"https://cognito-idp.us-east-1.amazonaws.com/{pool_id}",
    "client_id": client_id,
    "redirect_uri": "http://localhost:3000",
    "post_logout_redirect_uri": "http://localhost:3000",
    "response_type": "code",
    "scope": "email openid profile",
    "automaticSilentRenew": True,
    "agentRuntimeArn": runtime_arn,
    "awsRegion": "us-east-1",
    "copilotKitRuntimeUrl": "http://localhost:3001/copilotkit",
    "agentPattern": pattern,
}

os.makedirs(public_dir, exist_ok=True)
with open(f"{public_dir}/aws-exports.json", "w") as f:
    json.dump(aws_exports, f, indent=2)

print(f"✓ Stack: {stack_name}  |  Memory: {memory_id}")
print(f"✓ aws-exports.json → localhost:3001")
PYEOF

set -a && source "$ENV_FILE" 2>/dev/null || true && set +a
AGENT="$AGENT" STACK_NAME="$STACK_NAME" \
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up --watch "$@"