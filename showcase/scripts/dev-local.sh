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
  local src_py="$SHOWCASE_DIR/shared/python"
  local src_ts="$SHOWCASE_DIR/shared/typescript/tools"
  for pkg_dir in "$SHOWCASE_DIR"/packages/*/; do
    local pkg="$(basename "$pkg_dir")"
    if [ -d "$src_py" ] && grep -q "shared_python" "$pkg_dir/Dockerfile" 2>/dev/null; then
      rsync -a --delete "$src_py/" "$pkg_dir/shared_python/"
    fi
    if [ -d "$src_ts" ] && grep -q "shared_typescript" "$pkg_dir/Dockerfile" 2>/dev/null; then
      mkdir -p "$pkg_dir/shared_typescript"
      rsync -a --delete "$src_ts/" "$pkg_dir/shared_typescript/tools/"
    fi
  done
  # Per-cell: packages/<integration>/demos/<cell>/
  for cell_dir in "$SHOWCASE_DIR"/packages/*/demos/*/; do
    if [ -d "$src_py" ] && grep -q "shared_python" "$cell_dir/Dockerfile" 2>/dev/null; then
      rsync -a --delete "$src_py/" "$cell_dir/shared_python/"
    fi
    if [ -d "$src_ts" ] && grep -q "shared_typescript" "$cell_dir/Dockerfile" 2>/dev/null; then
      mkdir -p "$cell_dir/shared_typescript"
      rsync -a --delete "$src_ts/" "$cell_dir/shared_typescript/tools/"
    fi
  done
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
    docker compose -f "$COMPOSE_FILE" up -d --build "$@"
    ;;
  build)
    stage_shared
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
