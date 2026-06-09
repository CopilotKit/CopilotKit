#!/usr/bin/env bash
# Shared variables and helper functions for the showcase CLI.
# Sourced by bin/showcase — not meant to be executed directly.

# ── Paths ────────────────────────────────────────────────────────────────────

SHOWCASE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$SHOWCASE_ROOT/docker-compose.local.yml"
COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
ENV_FILE="$SHOWCASE_ROOT/.env"
PORTS_FILE="$SHOWCASE_ROOT/shared/local-ports.json"
AIMOCK_COMPOSE="$SHOWCASE_ROOT/tests/docker-compose.integrations.yml"

# ── Output helpers ───────────────────────────────────────────────────────────

die() {
  printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2
  exit 1
}

info() {
  printf '\033[0;36m▸ %s\033[0m\n' "$1"
}

warn() {
  printf '\033[1;33m⚠ %s\033[0m\n' "$1" >&2
}

success() {
  printf '\033[0;32m✓ %s\033[0m\n' "$1"
}

# ── Validation helpers ───────────────────────────────────────────────────────

need_slug() {
  [ -n "${1:-}" ] || die "slug required"
}

require_env() {
  [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE. Copy showcase/.env.example to showcase/.env and fill in keys."
}

# ── Docker / Compose helpers ─────────────────────────────────────────────────

stage_shared() {
  # Dereference tools/ and shared-tools/ symlinks into real copies so Docker
  # COPY can follow them (Docker build contexts can't traverse symlinks that
  # point outside the context).
  for pkg_dir in "$SHOWCASE_ROOT"/integrations/*/; do
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
  # Restore tools/ and shared-tools/ symlinks replaced by stage_shared.
  (cd "$SHOWCASE_ROOT" && git checkout -- integrations/*/tools integrations/*/shared-tools 2>/dev/null || true)
}

slug_to_container() {
  echo "showcase-${1}"
}

slug_to_port() {
  local slug="${1:?slug required}"
  if command -v jq &>/dev/null; then
    jq -r --arg s "$slug" '.[$s] // empty' "$PORTS_FILE"
  else
    # Fallback: simple grep/sed if jq is not available
    grep "\"$slug\"" "$PORTS_FILE" | sed 's/[^0-9]//g'
  fi
}

is_service_healthy() {
  local slug="${1:?slug required}"
  local container
  container="$(slug_to_container "$slug")"
  local health
  health="$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "missing")"
  [ "$health" = "healthy" ]
}

wait_healthy() {
  local slug="${1:?slug required}"
  local timeout="${2:-30}"
  local elapsed=0
  info "Waiting for $slug to become healthy (timeout ${timeout}s)..."
  while ! is_service_healthy "$slug"; do
    if [ "$elapsed" -ge "$timeout" ]; then
      die "$slug did not become healthy within ${timeout}s"
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  success "$slug is healthy (${elapsed}s)"
}

# ── Isolation helpers ───────────────────────────────────────────────────────

ISOLATE_NAME=""
ISOLATE_PORT_OFFSET=0
ISOLATE_SLOT=""
ISOLATE_ACTIVE=false
ISOLATE_TMPDIR=""

# Runtime state (slot registry + per-run scratch dirs) lives under
# XDG_STATE_HOME, NOT /tmp — /tmp gets wiped on reboot and is world-writable,
# which made stale-slot reaping racy and lost --keep'd run dirs across reboots.
_showcase_state_base() { printf '%s/copilotkit/showcase' "${XDG_STATE_HOME:-$HOME/.local/state}"; }

ISOLATE_SLOT_DIR="$(_showcase_state_base)/slots"
ISOLATE_STALE_THRESHOLD=7200  # 2 hours in seconds

# Claim an isolation slot using atomic mkdir. Slots start at 0 and increment.
# Each slot dir contains a "pid" file for stale-detection. The port offset is
# (slot + 1) * 200, so slot 0 → +200, slot 1 → +400, etc.
_claim_isolate_slot() {
  mkdir -p "$ISOLATE_SLOT_DIR"

  # Clean up stale slots first (crashed runs older than 2 hours, or dead PIDs)
  local slot_entry
  for slot_entry in "$ISOLATE_SLOT_DIR"/[0-9]*; do
    [ -d "$slot_entry" ] || continue
    local slot_pid_file="$slot_entry/pid"
    if [ -f "$slot_pid_file" ]; then
      local slot_pid
      slot_pid="$(cat "$slot_pid_file" 2>/dev/null)"
      # If the PID is dead, remove the stale slot
      if [ -n "$slot_pid" ] && ! kill -0 "$slot_pid" 2>/dev/null; then
        info "Reclaiming stale slot $(basename "$slot_entry") (PID $slot_pid dead)"
        rm -rf "$slot_entry"
        continue
      fi
    fi
    # Fallback: age-based cleanup if no pid file or pid check inconclusive
    if [ ! -f "$slot_pid_file" ]; then
      local slot_age
      if [[ "$OSTYPE" == darwin* ]]; then
        slot_age=$(( $(date +%s) - $(stat -f %m "$slot_entry") ))
      else
        slot_age=$(( $(date +%s) - $(stat -c %Y "$slot_entry") ))
      fi
      if [ "$slot_age" -gt "$ISOLATE_STALE_THRESHOLD" ]; then
        info "Reclaiming stale slot $(basename "$slot_entry") (age ${slot_age}s > ${ISOLATE_STALE_THRESHOLD}s)"
        rm -rf "$slot_entry"
      fi
    fi
  done

  # Claim the first available slot (mkdir is atomic — if it succeeds, we own it)
  local n=0
  while true; do
    if mkdir "$ISOLATE_SLOT_DIR/$n" 2>/dev/null; then
      ISOLATE_SLOT="$n"
      echo "$$" > "$ISOLATE_SLOT_DIR/$n/pid"
      ISOLATE_PORT_OFFSET=$(( (n + 1) * 200 ))
      return 0
    fi
    n=$((n + 1))
    if [ "$n" -gt 45 ]; then
      die "No isolation slots available (0-45 exhausted). Check $ISOLATE_SLOT_DIR/"
    fi
  done
}

# Release the claimed isolation slot
_release_isolate_slot() {
  if [ -n "$ISOLATE_SLOT" ] && [ -d "$ISOLATE_SLOT_DIR/$ISOLATE_SLOT" ]; then
    rm -rf "$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  fi
  # Remove the parent dir if now empty
  rmdir "$ISOLATE_SLOT_DIR" 2>/dev/null || true
  ISOLATE_SLOT=""
}

apply_isolation() {
  local name="${1:-}"
  ISOLATE_ACTIVE=true

  # docker compose project names must be lowercase ([a-z0-9_-]). Reject (or
  # normalize) uppercase so the user gets a clear error instead of an opaque
  # compose failure. We normalize-with-warn for ergonomic CLI use.
  if [ -n "$name" ] && [[ "$name" =~ [^a-z0-9_-] ]]; then
    local lowered
    lowered="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lowered" =~ ^[a-z0-9_-]+$ ]]; then
      warn "Isolation name '$name' has uppercase chars; lowercasing to '$lowered' (docker compose project-name constraint)"
      name="$lowered"
    else
      die "Invalid --isolate name '$name': must match [a-z0-9_-]+ (docker compose project-name constraint)"
    fi
  fi

  # Guard: clean up stale .iso-bak files from a prior botched run that
  # mutated originals in-place (the old approach). This makes migration safe.
  if [ -f "${PORTS_FILE}.iso-bak" ] || [ -f "${COMPOSE_FILE}.iso-bak" ]; then
    warn "Stale .iso-bak files found from a prior crash — restoring originals"
    [ -f "${PORTS_FILE}.iso-bak" ] && mv "${PORTS_FILE}.iso-bak" "$PORTS_FILE"
    [ -f "${COMPOSE_FILE}.iso-bak" ] && mv "${COMPOSE_FILE}.iso-bak" "$COMPOSE_FILE"
  fi

  # Claim a slot for unique port offsets
  _claim_isolate_slot

  # Build the isolation name, incorporating the slot for uniqueness
  if [ -z "$name" ]; then
    name="showcase-iso${ISOLATE_SLOT}"
  fi
  ISOLATE_NAME="$name"
  export COMPOSE_PROJECT_NAME="$name"

  # Create per-run scratch dir for overlay copies (originals stay untouched).
  # Keyed by the finalized project name (not the PID) so a --keep'd run is
  # locatable for manual teardown, and lives under XDG state, not /tmp.
  ISOLATE_TMPDIR="$(_showcase_state_base)/runs/$name"
  mkdir -p "$ISOLATE_TMPDIR"

  # Generate offset ports file in the temp dir
  local tmp_ports="$ISOLATE_TMPDIR/local-ports.json"
  python3 -c "
import json, sys
with open('$PORTS_FILE') as f:
    ports = json.load(f)
offset = {k: v + $ISOLATE_PORT_OFFSET for k, v in ports.items()}
with open('$tmp_ports', 'w') as f:
    json.dump(offset, f, indent=2)
    f.write('\n')
"

  # Generate offset compose file in the temp dir
  local tmp_compose="$ISOLATE_TMPDIR/docker-compose.local.yml"
  python3 -c "
import re
with open('$COMPOSE_FILE') as f:
    content = f.read()

def offset_port(m):
    indent = m.group(1)
    host = int(m.group(2))
    container = m.group(3)
    return f'{indent}- \"{host + $ISOLATE_PORT_OFFSET}:{container}\"'

content = re.sub(r'(\s+)- \"(\d+):(\d+)\"', offset_port, content)
content = content.replace('container_name: showcase-', 'container_name: $name-')

# Rewrite relative paths to absolute, anchored at SHOWCASE_ROOT. Without this,
# docker compose resolves them against the temp dir holding the rewritten
# compose file and fails (env_file: .env, build: ./pocketbase, volume mounts).
# We touch: build context (./xxx and 'context: ./xxx'), volumes (\"- ./xxx:\"),
# and env_file: .env / .env.local style references.
ROOT = '$SHOWCASE_ROOT'

import os.path as _osp
PARENT = _osp.dirname(ROOT.rstrip('/'))

def _abs(prefix, tail, base):
    return prefix + base.rstrip('/') + '/' + tail

# build: ../foo  /  build: ../   →  rooted at <parent-of-showcase>
content = re.sub(r'(\s+build:\s+)\.\./?([^\n]*)', lambda m: _abs(m.group(1), m.group(2), PARENT), content)
# build: ./foo                    →  rooted at <showcase>
content = re.sub(r'(\s+build:\s+)\./([^\n]+)', lambda m: _abs(m.group(1), m.group(2), ROOT), content)
# context: ../...                 →  rooted at <parent>
content = re.sub(r'(\s+context:\s+)\.\./?([^\n]*)', lambda m: _abs(m.group(1), m.group(2), PARENT), content)
# context: ./foo                  →  rooted at <showcase>
content = re.sub(r'(\s+context:\s+)\./([^\n]+)', lambda m: _abs(m.group(1), m.group(2), ROOT), content)
# dockerfile: ./foo
content = re.sub(r'(\s+dockerfile:\s+)\./([^\n]+)', lambda m: _abs(m.group(1), m.group(2), ROOT), content)
# volumes:  - ./foo:/bar    →  - <showcase>/foo:/bar
content = re.sub(r'(\s+-\s+)\./([^:\n]+:)', lambda m: _abs(m.group(1), m.group(2), ROOT), content)
# env_file: .env            →  <showcase>/.env
content = re.sub(r'(\s+env_file:\s+)\.env(\b)', lambda m: m.group(1) + ROOT + '/.env' + m.group(2), content)

with open('$tmp_compose', 'w') as f:
    f.write(content)
"

  # Override shell variables so all downstream code uses the temp files.
  # Originals are NEVER mutated.
  COMPOSE_FILE="$tmp_compose"
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE --project-name $name"
  PORTS_FILE="$tmp_ports"

  # Export for the TS harness CLI (config.ts / lifecycle.ts honor these).
  # Without SHOWCASE_COMPOSE_FILE the harness hardcodes the default compose
  # path, causing container-name collisions on a second concurrent --isolate.
  # SHOWCASE_INFRA_PORT_OFFSET shifts the hardcoded :4010/:8090/:3200 health
  # checks onto the isolated stack's offset host ports (otherwise the harness
  # would silently report the DEFAULT-project aimock/pocketbase as healthy).
  export LOCAL_PORTS_FILE="$tmp_ports"
  export SHOWCASE_COMPOSE_FILE="$tmp_compose"
  export SHOWCASE_INFRA_PORT_OFFSET="$ISOLATE_PORT_OFFSET"

  # Offset host-side URLs so any harness code referencing config.aimockUrl /
  # dashboardUrl / pocketbase.url talks to THIS project's instances (not the
  # default :4010 / :3200 / :8090).
  local aimock_host_port=$(( 4010 + ISOLATE_PORT_OFFSET ))
  local dashboard_host_port=$(( 3200 + ISOLATE_PORT_OFFSET ))
  local pocketbase_host_port=$(( 8090 + ISOLATE_PORT_OFFSET ))
  export AIMOCK_URL_LOCAL="http://localhost:${aimock_host_port}"
  export DASHBOARD_URL_LOCAL="http://localhost:${dashboard_host_port}"
  export DASHBOARD_PORT_LOCAL="$dashboard_host_port"
  export POCKETBASE_URL_LOCAL="http://localhost:${pocketbase_host_port}"

  # Idempotent: tear down any prior run with this name
  $COMPOSE_CMD down --remove-orphans 2>/dev/null || true

  info "Isolation active: project=$name slot=$ISOLATE_SLOT ports=+$ISOLATE_PORT_OFFSET tmpdir=$ISOLATE_TMPDIR"
}

restore_isolation() {
  if $ISOLATE_ACTIVE; then
    info "Tearing down isolated group: $ISOLATE_NAME (slot $ISOLATE_SLOT)"
    $COMPOSE_CMD down --remove-orphans 2>/dev/null || true
    # Just remove the temp dir — originals were never touched
    if [ -n "$ISOLATE_TMPDIR" ] && [ -d "$ISOLATE_TMPDIR" ]; then
      rm -rf "$ISOLATE_TMPDIR"
    fi
    # Release the isolation slot so other runs can claim it
    _release_isolate_slot
    ISOLATE_ACTIVE=false
  fi
}
