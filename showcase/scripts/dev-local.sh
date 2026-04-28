#!/usr/bin/env bash
# Run the Railway-equivalent Docker image for one or more showcase packages.
# Uses showcase/docker-compose.local.yml. API keys come from showcase/.env.
#
# Usage:
#   scripts/dev-local.sh up [<slug> ...]     # empty = all
#   scripts/dev-local.sh down [<slug> ...]
#   scripts/dev-local.sh build [<slug> ...]
#   scripts/dev-local.sh logs <slug>
#   scripts/dev-local.sh ps
#   scripts/dev-local.sh ports

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$(dirname "$HERE")"
COMPOSE_FILE="$SHOWCASE_DIR/docker-compose.local.yml"
ENV_FILE="$SHOWCASE_DIR/.env"
PORTS_FILE="$SHOWCASE_DIR/shared/local-ports.json"

stage_shared() {
  for pkg_dir in "$SHOWCASE_DIR"/integrations/*/; do
    # Dereference symlinks for Docker build context. Docker COPY cannot
    # follow symlinks that point outside the build context. Replace
    # tools/ and shared-tools/ symlinks with real copies of their targets.
    for link_name in tools shared-tools; do
      local link_path="$pkg_dir/$link_name"
      if [ -L "$link_path" ]; then
        local target
        target="$(readlink "$link_path")"
        # Resolve relative symlink targets against the link's directory
        if [[ "$target" != /* ]]; then
          target="$(cd "$(dirname "$link_path")" && cd "$(dirname "$target")" && pwd)/$(basename "$target")"
        fi
        if [ -d "$target" ]; then
          rm "$link_path"
          rsync -a "$target/" "$link_path/"
        fi
      fi
    done
  done
}

restore_symlinks() {
  # Restore tools/ and shared-tools/ symlinks that stage_shared replaced
  # with real directories. git checkout restores them from the index.
  (cd "$SHOWCASE_DIR" && git checkout -- integrations/*/tools integrations/*/shared-tools 2>/dev/null || true)
}

require_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE. Copy showcase/.env.example to showcase/.env and fill in keys." >&2
    exit 1
  fi
}

cmd="${1:-}"
shift || true

case "$cmd" in
  up)
    require_env
    stage_shared
    trap restore_symlinks EXIT
    docker compose -f "$COMPOSE_FILE" up -d --build "$@"
    ;;
  build)
    stage_shared
    trap restore_symlinks EXIT
    docker compose -f "$COMPOSE_FILE" build "$@"
    ;;
  down)
    docker compose -f "$COMPOSE_FILE" down "$@"
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f "$@"
    ;;
  ps)
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  ports)
    cat "$PORTS_FILE"
    ;;
  *)
    sed -n '2,13p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
