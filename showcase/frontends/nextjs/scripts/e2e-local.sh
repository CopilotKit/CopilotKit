#!/usr/bin/env bash
# Runs the shared e2e suite for one integration against the local Docker stack.
#
# Usage (from any folder):
#   showcase/frontends/nextjs/scripts/e2e-local.sh [--build] <slug> [playwright args...]
#
#   e2e-local.sh strands
#   e2e-local.sh --build langgraph-python tests/e2e/agentic-chat.spec.ts
#
# 1. Starts these services of showcase/docker-compose.local.yml:
#    - aimock;
#    - the integration's own service, for its agent. built-in-agent and mastra
#      run inside the app, so they have no service to start;
#    - frontend-nextjs, the app, at http://localhost:3200.
#    Existing images are reused. --build rebuilds them.
# 2. Waits for the app's /api/health and for the integration's agent.
# 3. Runs `npm run e2e` with INTEGRATION=<slug> and BASE_URL=http://localhost:3200,
#    and exits with its code. Arguments after the slug go to Playwright.
#
# The containers keep running after the suite, so the next run starts fast.
#
# Needs Docker, showcase/.env (copy showcase/.env.example), and the app's
# node_modules (npm ci --legacy-peer-deps in showcase/frontends/nextjs).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Sets SHOWCASE_ROOT, COMPOSE_FILE and ENV_FILE, and defines die, info,
# success, require_env and wait_healthy.
# shellcheck source=../../../scripts/cli/_common.sh
source "$APP_DIR/../../scripts/cli/_common.sh"

APP_SERVICE="frontend-nextjs"
APP_CONTAINER="showcase-$APP_SERVICE"
BASE_URL="http://localhost:3200"
# A cold integration image can take minutes to start its agent.
WAIT_SECONDS=300
# Any HTTP answer, even a 404, means that the agent's server is up.
AGENT_PROBE='fetch(process.argv[1], { signal: AbortSignal.timeout(5000) }).then(() => process.exit(0), () => process.exit(1))'

usage() {
  echo "Usage: $0 [--build] <slug> [playwright args...]" >&2
  exit 2
}

# Waits until the agent at $1 answers HTTP. The request goes from the app
# container, so it takes the same network path as the app. The integration
# container's own healthcheck does not cover this: its website answers
# /api/health before the agent is up.
wait_for_agent() {
  local url="$1"
  local elapsed=0
  info "Waiting for the agent at $url (timeout ${WAIT_SECONDS}s)..."
  until docker exec "$APP_CONTAINER" node -e "$AGENT_PROBE" "$url"; do
    if [ "$elapsed" -ge "$WAIT_SECONDS" ]; then
      die "The agent at $url did not answer within ${WAIT_SECONDS}s. See its logs: docker logs showcase-$slug"
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  success "The agent at $url answers (${elapsed}s)"
}

build=false
args=()
for arg in "$@"; do
  case "$arg" in
    --build) build=true ;;
    -h | --help) usage ;;
    *) args+=("$arg") ;;
  esac
done
set -- ${args[@]+"${args[@]}"}
[ $# -gt 0 ] || usage
slug="$1"
shift

# [:lower:] and not a-z: in bash 3.2, a-z can match capitals in some locales.
case "$slug" in
  "" | -* | *[![:lower:][:digit:]-]*) die "\"$slug\" is not an integration slug." ;;
esac
[ -f "$SHOWCASE_ROOT/integrations/$slug/manifest.yaml" ] ||
  die "Unknown integration \"$slug\": showcase/integrations/$slug/manifest.yaml does not exist."
require_env
[ -x "$APP_DIR/node_modules/.bin/tsx" ] ||
  die "The app has no node_modules. Run: (cd showcase/frontends/nextjs && npm ci --legacy-peer-deps)"

# The integration's agent addresses, one NAME=URL line each. The host is the
# integration's compose service, which has the same name as the slug. An
# integration that runs inside the app has none.
addresses="$(cd "$APP_DIR" && node_modules/.bin/tsx scripts/agent-env.ts "$slug" "$slug")"

# aimock is in the infra profile. Naming the services keeps the rest of that
# profile down.
compose=(docker compose -f "$COMPOSE_FILE" --profile infra --profile "$APP_SERVICE")
services=(aimock "$APP_SERVICE")
if [ -n "$addresses" ]; then
  compose+=(--profile "$slug")
  services+=("$slug")
fi
up=(up -d)
if $build; then
  up+=(--build)
fi

info "Starting ${services[*]}..."
"${compose[@]}" "${up[@]}" "${services[@]}"
# aimock replays sequence-indexed fixtures in order, and a run uses them up.
# A fresh aimock for every run gives a second run the same results as the
# first.
info "Restarting aimock so this run starts with fresh fixtures..."
"${compose[@]}" restart aimock
wait_healthy aimock "$WAIT_SECONDS"
wait_healthy "$APP_SERVICE" "$WAIT_SECONDS"
while IFS= read -r address; do
  if [ -n "$address" ]; then
    wait_for_agent "${address#*=}"
  fi
done <<<"$addresses"

info "Running the e2e suite for $slug against $BASE_URL."
info "To stop the stack: ${compose[*]} stop ${services[*]}"
cd "$APP_DIR"
export INTEGRATION="$slug"
export BASE_URL
exec npm run e2e -- "$@"
