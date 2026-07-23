#!/usr/bin/env bash
# showcase doctor — diagnose common local stack issues
# Sourced by the main dispatcher; do not execute directly.

CMD_DOCTOR_DESC="Diagnose common local stack issues"

usage_doctor() {
  cat <<'HELP'
Usage: showcase doctor

Diagnose common issues with the local showcase stack.

Checks performed:
  - Docker engine and Compose availability
  - Depot CLI interception (common build gotcha)
  - ENV file and API keys
  - Compose file validity
  - Container status and stale images
  - Aimock health and fixture files
  - Port conflicts
HELP
}

# ── Color helpers ────────────────────────────────────────────────────────────

_doctor_has_color() {
  [ -t 1 ] && { [ "${TERM:-dumb}" != "dumb" ] || [ -n "${FORCE_COLOR:-}" ]; }
}

_doctor_pass() {
  if _doctor_has_color; then
    printf '\033[0;32m%-22s\033[0m %s\n' "  ✓ $1" "$2"
  else
    printf '%-22s %s\n' "  ✓ $1" "$2"
  fi
  _DOCTOR_PASS=$((_DOCTOR_PASS + 1))
}

_doctor_warn() {
  if _doctor_has_color; then
    printf '\033[1;33m%-22s\033[0m %s\n' "  ⚠ $1" "$2"
  else
    printf '%-22s %s\n' "  ⚠ $1" "$2"
  fi
  _DOCTOR_WARN=$((_DOCTOR_WARN + 1))
}

_doctor_fail() {
  if _doctor_has_color; then
    printf '\033[1;31m%-22s\033[0m %s\n' "  ✗ $1" "$2"
  else
    printf '%-22s %s\n' "  ✗ $1" "$2"
  fi
  _DOCTOR_FAIL=$((_DOCTOR_FAIL + 1))
}

# ── Individual checks ───────────────────────────────────────────────────────

_check_docker_engine() {
  if ! docker info >/dev/null 2>&1; then
    _doctor_fail "Docker engine" "Not running — start Docker Desktop or dockerd"
    return
  fi
  local version
  version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")"
  _doctor_pass "Docker engine" "Docker $version"
}

_check_docker_compose() {
  if ! docker compose version >/dev/null 2>&1; then
    _doctor_fail "Docker Compose" "Not available — install docker-compose-plugin"
    return
  fi
  local version
  version="$(docker compose version --short 2>/dev/null || echo "unknown")"
  _doctor_pass "Docker Compose" "v$version"
}

_check_depot_interception() {
  local docker_path
  docker_path="$(which docker 2>/dev/null || true)"

  if [ -n "$docker_path" ] && echo "$docker_path" | grep -qi "depot"; then
    _doctor_warn "Depot CLI" "Detected — use DEPOT_DISABLE=1 for local builds"
    return
  fi

  # Also check if depot's buildx builder is active even without shim
  if DEPOT_DISABLE=1 docker buildx ls 2>/dev/null | grep -q "depot"; then
    _doctor_warn "Depot CLI" "Depot buildx builder active — use --builder desktop-linux"
    return
  fi

  _doctor_pass "Depot CLI" "No Depot interception detected"
}

_check_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    _doctor_fail "ENV file" ".env missing — copy showcase/.env.example"
    return
  fi

  local key_count=0
  local has_openai=false
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    # Count lines with = sign (key=value pairs)
    if [[ "$line" == *"="* ]]; then
      key_count=$((key_count + 1))
      if [[ "$line" == OPENAI_API_KEY=* ]]; then
        local val="${line#OPENAI_API_KEY=}"
        # Strip quotes
        val="${val#\"}"
        val="${val%\"}"
        val="${val#\'}"
        val="${val%\'}"
        [ -n "$val" ] && has_openai=true
      fi
    fi
  done < "$ENV_FILE"

  if [ "$has_openai" = false ]; then
    _doctor_warn "ENV file" ".env present ($key_count keys) but missing OPENAI_API_KEY"
    return
  fi

  _doctor_pass "ENV file" ".env present ($key_count keys)"
}

_check_compose_file() {
  if [ ! -f "$COMPOSE_FILE" ]; then
    _doctor_fail "Compose file" "docker-compose.local.yml missing"
    return
  fi

  if ! docker compose -f "$COMPOSE_FILE" config --quiet 2>/dev/null; then
    _doctor_fail "Compose file" "docker-compose.local.yml failed to parse"
    return
  fi

  local service_count
  service_count="$(docker compose -f "$COMPOSE_FILE" config --services 2>/dev/null | wc -l | tr -d ' ')"
  _doctor_pass "Compose file" "docker-compose.local.yml valid ($service_count services)"
}

_check_running_containers() {
  local containers
  containers="$(docker ps -a --filter "name=showcase-" --format '{{.Names}}|{{.Status}}|{{.Image}}' 2>/dev/null || true)"

  if [ -z "$containers" ]; then
    _doctor_warn "Running containers" "No showcase containers found"
    return
  fi

  local running=0
  local total=0
  while IFS='|' read -r name status image; do
    total=$((total + 1))
    if echo "$status" | grep -qi "^up"; then
      running=$((running + 1))
    fi
  done <<< "$containers"

  if [ "$running" -eq 0 ]; then
    _doctor_warn "Running containers" "0 of $total running"
  else
    _doctor_pass "Running containers" "$running of $total running"
  fi
}

_check_stale_images() {
  local containers
  containers="$(docker ps --filter "name=showcase-" --format '{{.Names}}' 2>/dev/null || true)"

  if [ -z "$containers" ]; then
    # No running containers, nothing to check
    _doctor_pass "Stale images" "No running containers to check"
    return
  fi

  local stale_list=""
  while IFS= read -r cname; do
    local slug="${cname#showcase-}"

    # Get the image ID the container is running
    local container_image_id
    container_image_id="$(docker inspect --format='{{.Image}}' "$cname" 2>/dev/null || true)"
    [ -z "$container_image_id" ] && continue

    # Get the latest local image ID for this slug
    local latest_image_id
    latest_image_id="$(docker images --format '{{.ID}}' "showcase-${slug}:local" 2>/dev/null | head -1)"
    [ -z "$latest_image_id" ] && continue

    # Compare (container image is sha256:xxx, local image is short hash)
    if ! echo "$container_image_id" | grep -q "$latest_image_id"; then
      if [ -n "$stale_list" ]; then
        stale_list="$stale_list, $slug"
      else
        stale_list="$slug"
      fi
    fi
  done <<< "$containers"

  if [ -n "$stale_list" ]; then
    _doctor_warn "Stale images" "$stale_list using old image (recreate to fix)"
  else
    _doctor_pass "Stale images" "All containers using latest images"
  fi
}

_check_aimock_health() {
  local container="showcase-aimock"

  # Check if container exists and is running
  local status
  status="$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "missing")"

  if [ "$status" = "missing" ] || [ "$status" = "exited" ]; then
    _doctor_warn "Aimock" "Container not running"
    return
  fi

  local health
  health="$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")"

  if [ "$health" = "healthy" ]; then
    # Try to get fixture count from the health endpoint
    local fixture_info=""
    local health_response
    health_response="$(curl -s --max-time 3 http://localhost:4010/health 2>/dev/null || true)"
    if [ -n "$health_response" ] && command -v jq &>/dev/null; then
      local fixture_count
      fixture_count="$(echo "$health_response" | jq -r '.fixtures // .fixtureCount // empty' 2>/dev/null || true)"
      [ -n "$fixture_count" ] && fixture_info=", $fixture_count fixtures loaded"
    fi
    _doctor_pass "Aimock" "Healthy${fixture_info}"
  else
    _doctor_warn "Aimock" "Running but $health"
  fi
}

_check_fixture_files() {
  local fixture_dir="$SHOWCASE_ROOT/aimock"
  local file_count=0
  local total_size=0

  if [ ! -d "$fixture_dir" ]; then
    _doctor_warn "Fixture files" "aimock/ directory not found"
    return
  fi

  for f in "$fixture_dir"/*.json; do
    [ -f "$f" ] || continue
    file_count=$((file_count + 1))
    local fsize
    # macOS stat vs GNU stat
    if stat --version >/dev/null 2>&1; then
      fsize="$(stat -c%s "$f" 2>/dev/null || echo 0)"
    else
      fsize="$(stat -f%z "$f" 2>/dev/null || echo 0)"
    fi
    total_size=$((total_size + fsize))
  done

  if [ "$file_count" -eq 0 ]; then
    _doctor_warn "Fixture files" "No .json files in aimock/"
    return
  fi

  # Format size nicely
  local size_str
  if [ "$total_size" -ge 1048576 ]; then
    size_str="$((total_size / 1048576)) MB"
  elif [ "$total_size" -ge 1024 ]; then
    size_str="$((total_size / 1024)) KB"
  else
    size_str="$total_size B"
  fi

  _doctor_pass "Fixture files" "$file_count files ($size_str)"
}

_check_port_conflicts() {
  if [ ! -f "$PORTS_FILE" ]; then
    _doctor_warn "Port conflicts" "local-ports.json not found"
    return
  fi

  local conflicts=""
  local port_list

  if command -v jq &>/dev/null; then
    port_list="$(jq -r 'to_entries[] | "\(.key):\(.value)"' "$PORTS_FILE" 2>/dev/null)"
  else
    # Fallback: parse JSON manually
    port_list="$(grep -o '"[^"]*"[[:space:]]*:[[:space:]]*[0-9]*' "$PORTS_FILE" | sed 's/"//g; s/[[:space:]]*:[[:space:]]*/:/g')"
  fi

  # Also check well-known ports: aimock=4010, pocketbase=8090
  port_list="$port_list
aimock:4010
pocketbase:8090"

  while IFS=':' read -r slug port; do
    [ -z "$port" ] && continue

    # Check if port is in use by a non-Docker process
    local listeners
    listeners="$(lsof -i :"$port" -sTCP:LISTEN -P -n 2>/dev/null | tail -n +2 || true)"
    [ -z "$listeners" ] && continue

    # Filter out Docker/com.docker processes
    local non_docker
    non_docker="$(echo "$listeners" | grep -vi "docker\|com.docker" || true)"
    [ -z "$non_docker" ] && continue

    local proc_name
    proc_name="$(echo "$non_docker" | head -1 | awk '{print $1}')"
    if [ -n "$conflicts" ]; then
      conflicts="$conflicts, :$port ($proc_name)"
    else
      conflicts=":$port ($proc_name)"
    fi
  done <<< "$port_list"

  if [ -n "$conflicts" ]; then
    _doctor_warn "Port conflicts" "$conflicts"
  else
    _doctor_pass "Port conflicts" "None detected"
  fi
}

# ── Main entry point ────────────────────────────────────────────────────────

cmd_doctor() {
  _DOCTOR_PASS=0
  _DOCTOR_WARN=0
  _DOCTOR_FAIL=0

  echo ""
  echo "showcase doctor"
  echo "─────────────────────────────────"

  _check_docker_engine
  _check_docker_compose
  _check_depot_interception
  _check_env_file
  _check_compose_file
  _check_running_containers
  _check_stale_images
  _check_aimock_health
  _check_fixture_files
  _check_port_conflicts

  echo "─────────────────────────────────"

  local summary="${_DOCTOR_PASS} passed, ${_DOCTOR_WARN} warning"
  [ "$_DOCTOR_WARN" -ne 1 ] && summary="${summary}s"
  summary="${summary}, ${_DOCTOR_FAIL} failed"

  if [ "$_DOCTOR_FAIL" -gt 0 ]; then
    if _doctor_has_color; then
      printf '\033[1;31m%s\033[0m\n' "  $summary"
    else
      echo "  $summary"
    fi
    return 1
  elif [ "$_DOCTOR_WARN" -gt 0 ]; then
    if _doctor_has_color; then
      printf '\033[1;33m%s\033[0m\n' "  $summary"
    else
      echo "  $summary"
    fi
  else
    if _doctor_has_color; then
      printf '\033[0;32m%s\033[0m\n' "  $summary"
    else
      echo "  $summary"
    fi
  fi
  echo ""
}
