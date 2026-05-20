#!/usr/bin/env bash
# showcase recreate — force-recreate services to pick up new images

CMD_RECREATE_DESC="Force-recreate a service (picks up new image)"

usage_recreate() {
  cat <<'HELP'
Usage: showcase recreate <slug> [slug...] [options]

Force-recreate service containers to pick up a new Docker image.
Unlike 'restart', this ensures the container uses the latest image.

Options:
  --build     Rebuild the image before recreating
  --no-wait   Don't wait for the container to become healthy

Examples:
  showcase recreate mastra           # recreate with current image
  showcase recreate aimock           # recreate aimock (uses test compose)
  showcase recreate mastra --build   # rebuild + recreate
  showcase recreate mastra aimock    # recreate multiple services
HELP
}

cmd_recreate() {
  local slugs=()
  local no_wait=0
  local build=0

  # Parse args: separate slugs from flags
  for arg in "$@"; do
    case "$arg" in
      --no-wait) no_wait=1 ;;
      --build)   build=1 ;;
      -h|--help) usage_recreate; return 0 ;;
      -*)        die "Unknown option: $arg (see 'showcase recreate --help')" ;;
      *)         slugs+=("$arg") ;;
    esac
  done

  [ ${#slugs[@]} -gt 0 ] || die "Usage: showcase recreate <slug> [slug...] [--build] [--no-wait]"

  for slug in "${slugs[@]}"; do
    need_slug "$slug"

    # Pick the right compose file: aimock uses the test compose, everything
    # else uses the main local compose.
    local compose
    if [ "$slug" = "aimock" ]; then
      compose="$AIMOCK_COMPOSE"
    else
      compose="$COMPOSE_FILE"
    fi

    info "Force-recreating showcase-${slug} (picks up new image, unlike restart)..."

    if [ "$build" -eq 1 ]; then
      trap restore_symlinks EXIT
      stage_shared
      docker compose -f "$compose" up -d --build --force-recreate "$slug"
    else
      docker compose -f "$compose" up -d --force-recreate "$slug"
    fi

    if [ "$no_wait" -eq 0 ]; then
      wait_healthy "$slug" 30
    fi

    # Print the image ID so the user can verify it changed
    local container
    container="$(slug_to_container "$slug")"
    local image_id
    image_id="$(docker inspect --format='{{.Image}}' "$container" 2>/dev/null || echo "unknown")"
    # Truncate sha256:... to first 12 hex chars
    image_id="${image_id#sha256:}"
    image_id="${image_id:0:12}"
    success "showcase-${slug} recreated — image: ${image_id}"
  done
}
