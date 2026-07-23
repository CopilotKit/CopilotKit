#!/usr/bin/env bash
# showcase aimock-rebuild — rebuild local aimock from source checkout
# Sourced by the main dispatcher; do not execute directly.

CMD_AIMOCK_REBUILD_DESC="Rebuild local aimock from source checkout"

usage_aimock_rebuild() {
  cat <<'HELP'
Usage: showcase aimock-rebuild [--from <path>]

Rebuild aimock from a local source checkout and redeploy the container.

Options:
  --from <path>    Path to local aimock checkout
                   Default: $AIMOCK_SRC or ../aimock (sibling repo)

Steps performed:
  1. npm run build (in aimock source)
  2. Docker build (DEPOT_DISABLE=1, local --load)
  3. Force-recreate aimock container
  4. Wait for healthy

Environment:
  AIMOCK_SRC       Default aimock source directory
HELP
}

cmd_aimock_rebuild() {
  local aimock_src=""

  # ── Parse arguments ──────────────────────────────────────────────
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from)
        [[ -z "${2:-}" ]] && die "--from requires a path argument"
        aimock_src="$2"
        shift 2
        ;;
      -h|--help)
        usage_aimock_rebuild
        return 0
        ;;
      *)
        die "Unknown argument: $1 (see showcase aimock-rebuild --help)"
        ;;
    esac
  done

  # ── Resolve aimock source directory ──────────────────────────────
  if [[ -z "$aimock_src" ]]; then
    if [[ -n "${AIMOCK_SRC:-}" && -d "$AIMOCK_SRC" ]]; then
      aimock_src="$AIMOCK_SRC"
    elif [[ -d "$SHOWCASE_ROOT/../../aimock" ]]; then
      aimock_src="$SHOWCASE_ROOT/../../aimock"
    elif [[ -d "$SHOWCASE_ROOT/../aimock" ]]; then
      aimock_src="$SHOWCASE_ROOT/../aimock"
    else
      die "Cannot find aimock source. Set AIMOCK_SRC or use --from <path>"
    fi
  fi

  # Canonicalise and validate
  aimock_src="$(cd "$aimock_src" 2>/dev/null && pwd)" \
    || die "Cannot resolve aimock source path"
  [[ -f "$aimock_src/package.json" ]] \
    || die "No package.json in $aimock_src — is this an aimock checkout?"

  info "aimock source: $aimock_src"

  local step_start total_start
  total_start=$(date +%s.%N 2>/dev/null || date +%s)

  # ── Step 1: npm build ───────────────────────────────────────────
  info "Step 1/4: npm run build"
  step_start=$(date +%s.%N 2>/dev/null || date +%s)
  (cd "$aimock_src" && npm run build) || die "npm run build failed in $aimock_src"
  local build_elapsed
  build_elapsed=$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N 2>/dev/null || date +%s) - $step_start}")
  success "npm build (${build_elapsed}s)"

  # ── Step 2: Docker build ────────────────────────────────────────
  info "Step 2/4: Docker build"
  step_start=$(date +%s.%N 2>/dev/null || date +%s)

  # Detect available builder
  local builder
  if docker buildx ls 2>/dev/null | grep -q desktop-linux; then
    builder="desktop-linux"
  else
    builder="default"
  fi
  info "Using builder: $builder"

  DEPOT_DISABLE=1 docker buildx build \
    --builder "$builder" \
    --load \
    -t aimock:local \
    "$aimock_src" \
    || die "Docker build failed"

  local docker_elapsed
  docker_elapsed=$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N 2>/dev/null || date +%s) - $step_start}")
  success "Docker build (${docker_elapsed}s)"

  # ── Step 3: Force-recreate container ────────────────────────────
  info "Step 3/4: Force-recreate aimock container"
  step_start=$(date +%s.%N 2>/dev/null || date +%s)

  docker compose -f "$AIMOCK_COMPOSE" up -d --force-recreate aimock \
    || die "Failed to recreate aimock container"

  local recreate_elapsed
  recreate_elapsed=$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N 2>/dev/null || date +%s) - $step_start}")
  success "Force-recreate (${recreate_elapsed}s)"

  # ── Step 4: Wait for healthy ────────────────────────────────────
  info "Step 4/4: Waiting for aimock to become healthy"
  step_start=$(date +%s.%N 2>/dev/null || date +%s)

  local container_name="showcase-aimock"
  local timeout_secs=30
  local deadline=$((SECONDS + timeout_secs))
  local status=""

  while [[ $SECONDS -lt $deadline ]]; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container_name" 2>/dev/null || echo "missing")
    case "$status" in
      healthy)
        local health_elapsed
        health_elapsed=$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N 2>/dev/null || date +%s) - $step_start}")
        success "Healthy (${health_elapsed}s)"

        local total_elapsed
        total_elapsed=$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N 2>/dev/null || date +%s) - $total_start}")
        success "aimock rebuilt and healthy (total ${total_elapsed}s)"
        return 0
        ;;
      unhealthy)
        warn "Container reports unhealthy — retrying..."
        ;;
    esac
    printf "."
    sleep 1
  done

  # Timed out
  printf "\n"
  local total_elapsed
  total_elapsed=$(awk "BEGIN{printf \"%.1f\", $(date +%s.%N 2>/dev/null || date +%s) - $total_start}")
  warn "aimock rebuilt but health check timed out after ${timeout_secs}s (container may still be starting)"
  warn "Last status: $status (total ${total_elapsed}s)"
  return 1
}
