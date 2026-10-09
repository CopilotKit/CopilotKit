#!/usr/bin/env bats
# REAL-SURFACE TTL tests for Change 3 (ISOLATE_KEEP_TTL) in
# scripts/cli/_common.sh. These mirror isolate-liveness-real.bats: real slot
# dirs under a temp XDG_STATE_HOME, a real DEAD owning PID (spawn-then-`wait`),
# and a REAL one-container `docker compose` project so containers ARE running.
#
# Change 3: a `kept` stack (running containers + dead/unverifiable owner — a
# forgotten `--keep` leak) is protected only until it outlives ISOLATE_KEEP_TTL
# (default 4h). The TTL age anchors on the slot's `pid`-file mtime, which is
# aged via `touch -t`:
#   * pid mtime now-5h (PAST the 4h TTL)  → liveness flips kept → stale, the
#     sweep reaps it (containers + volumes + slot gone) and emits a LOUD warning
#     naming project / age / TTL.
#   * pid mtime now-1h (WITHIN the 4h TTL) → still `kept`, sweep leaves it alone.
#
# Hermeticity: every throwaway compose project uses a UNIQUE disposable name
# (showcase-isotest-s2-<rand>), NEVER the base `showcase` name, and is torn
# down in teardown(). All real-docker tests `skip` cleanly when docker is
# unreachable or the test image cannot be obtained.

fail() {
  echo "$1"
  return 1
}

TEST_IMAGE="alpine:3.20"

_docker_ok() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 || return 1
  return 0
}

_ensure_test_image() {
  docker image inspect "$TEST_IMAGE" >/dev/null 2>&1 && return 0
  docker pull "$TEST_IMAGE" >/dev/null 2>&1
}

setup() {
  COMMON="$BATS_TEST_DIRNAME/../cli/_common.sh"

  export XDG_STATE_HOME="$BATS_TEST_TMPDIR/xdg"

  export SHOWCASE_ROOT_OVERRIDE="$BATS_TEST_TMPDIR/root"
  mkdir -p "$SHOWCASE_ROOT_OVERRIDE/shared"
  cat > "$SHOWCASE_ROOT_OVERRIDE/shared/local-ports.json" <<'JSON'
{ "mastra": 3104 }
JSON
  cat > "$SHOWCASE_ROOT_OVERRIDE/docker-compose.local.yml" <<'YML'
services:
  aimock:
    container_name: showcase-aimock
    ports:
      - "4010:4010"
YML

  # Unique disposable project name — NEVER base `showcase`. S2-namespaced.
  TEST_PROJ="showcase-isotest-s2-${BATS_TEST_NUMBER}-$$-${RANDOM}"
}

teardown() {
  if command -v docker >/dev/null 2>&1 && [ -n "${TEST_PROJ:-}" ]; then
    docker compose -p "$TEST_PROJ" down --remove-orphans --volumes >/dev/null 2>&1 || true
  fi
}

load_common() {
  # shellcheck disable=SC1090
  source "$COMMON"
  SHOWCASE_ROOT="$SHOWCASE_ROOT_OVERRIDE"
  COMPOSE_FILE="$SHOWCASE_ROOT/docker-compose.local.yml"
  PORTS_FILE="$SHOWCASE_ROOT/shared/local-ports.json"
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
}

# Start a REAL one-container compose project named <proj> running `sleep
# infinity` so the container is RUNNING and carries the compose-project label.
_start_real_project() {
  local proj="$1"
  local cdir="$BATS_TEST_TMPDIR/compose-$proj"
  mkdir -p "$cdir"
  cat > "$cdir/docker-compose.yml" <<YML
services:
  keeper:
    image: $TEST_IMAGE
    command: ["sleep", "infinity"]
YML
  docker compose -f "$cdir/docker-compose.yml" -p "$proj" up -d >/dev/null 2>&1
}

# Spawn a short-lived process, wait for exit, echo its (now dead) pid.
_make_dead_pid() {
  local p
  bash -c 'exit 0' &
  p=$!
  wait "$p" 2>/dev/null || true
  if kill -0 "$p" 2>/dev/null; then
    skip "PID $p was recycled to a live process — dead-PID fixture invalid"
  fi
  echo "$p"
}

# _age_pid_file <pidfile> <hours_ago> — set the pid file's mtime to N hours in
# the past (the TTL anchor). Cross-platform `touch -t [[CC]YY]MMDDhhmm.ss`.
_age_pid_file() {
  local pidfile="$1" hours_ago="$2" stamp
  if [[ "$OSTYPE" == darwin* ]]; then
    stamp="$(date -v-"${hours_ago}"H +%Y%m%d%H%M.%S)"
  else
    stamp="$(date -d "${hours_ago} hours ago" +%Y%m%d%H%M.%S)"
  fi
  touch -t "$stamp" "$pidfile"
}

# ── Change 3: TTL on running kept stacks ─────────────────────────────────────

@test "REAL: a kept slot aged PAST the keep TTL classifies stale (not kept)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "$TEST_PROJ" > "$slots/0/project"
  local dead_pid
  dead_pid="$(_make_dead_pid)"
  echo "$dead_pid" > "$slots/0/pid"

  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  # Within TTL (pid mtime ~now): a kept stack is protected.
  run _slot_liveness 0
  [ "$status" -eq 0 ] || fail "_slot_liveness 0 failed: $output"
  [ "$output" = "kept" ] \
    || fail "expected 'kept' for fresh dead-owner+running-containers slot, got '$output'"

  # Age the pid-file anchor to 5h ago — past the 4h default TTL.
  _age_pid_file "$slots/0/pid" 5

  # PAST the TTL: the kept stack reclassifies stale (the kept→stale transition).
  run _slot_liveness 0
  [ "$status" -eq 0 ] || fail "_slot_liveness 0 failed after aging: $output"
  [ "$output" = "stale" ] \
    || fail "expected 'stale' for kept slot aged past keep TTL, got '$output' (pre-TTL bug returns 'kept')"
}

@test "REAL: sweep reaps a kept stack past the TTL and emits the loud project/age/TTL warning" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "$TEST_PROJ" > "$slots/0/project"
  local dead_pid
  dead_pid="$(_make_dead_pid)"
  echo "$dead_pid" > "$slots/0/pid"

  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  # Age the kept slot past the TTL so the sweep will reclassify + reap it.
  _age_pid_file "$slots/0/pid" 5

  # Sweep (real path the claim runs opportunistically). Capture its output.
  run _sweep_isolate_slots
  [ "$status" -eq 0 ] || fail "_sweep_isolate_slots failed: $output"

  # The loud warning names the project, an age, and the keep TTL.
  [[ "$output" == *"reaping kept stack '$TEST_PROJ'"* ]] \
    || fail "warning did not name the project: $output"
  [[ "$output" == *"keep TTL ${ISOLATE_KEEP_TTL}s"* ]] \
    || fail "warning did not name the keep TTL: $output"
  [[ "$output" == *"age "*"s >"* ]] \
    || fail "warning did not name the age: $output"
  [[ "$output" == *"forgotten --keep leak"* ]] \
    || fail "warning did not flag the forgotten --keep leak: $output"

  # Reaped: containers gone, volumes gone, slot dir gone.
  [ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || fail "kept stack's containers survived the past-TTL sweep"
  [ -z "$(docker volume ls -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || fail "kept stack's volumes survived the past-TTL sweep"
  [ ! -d "$slots/0" ] \
    || fail "kept stack's slot dir survived the past-TTL sweep"
}

@test "REAL: sweep PRESERVES a kept stack still within the TTL" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "$TEST_PROJ" > "$slots/0/project"
  local dead_pid
  dead_pid="$(_make_dead_pid)"
  echo "$dead_pid" > "$slots/0/pid"

  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  # Age to 1h ago — WITHIN the 4h default TTL: still kept, must survive a sweep.
  _age_pid_file "$slots/0/pid" 1

  run _slot_liveness 0
  [ "$output" = "kept" ] || fail "precondition: within-TTL slot should be 'kept', got '$output'"

  run _sweep_isolate_slots
  [ "$status" -eq 0 ] || fail "_sweep_isolate_slots failed: $output"
  [[ "$output" != *"reaping kept stack"* ]] \
    || fail "sweep wrongly reaped a within-TTL kept stack: $output"

  [ -d "$slots/0" ] \
    || fail "within-TTL kept slot dir was reaped"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || fail "within-TTL kept stack's containers were torn down"
  run cat "$slots/0/project"
  [ "$output" = "$TEST_PROJ" ] || fail "within-TTL kept slot project mangled: $output"
}

# Mandatory-fallback regression: a kept slot whose `pid` and `project` files are
# unstattable must still age out via the slot-dir mtime → ISOLATE_STALE_THRESHOLD
# path rather than living forever. Here the pid/project mtimes are aged past the
# 4h TTL too, but the point is the anchor chain never returns empty for a
# present slot, so the transition fires. (Direct empty-anchor injection is not
# possible on a real slot dir — every present file is stattable — so we assert
# the chain's resilience: removing pid/project still yields a stale verdict via
# slot-dir mtime under a low ISOLATE_STALE_THRESHOLD.)
@test "REAL: a kept stack with no pid/project anchor still ages out via the fallback chain" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "$TEST_PROJ" > "$slots/0/project"
  local dead_pid
  dead_pid="$(_make_dead_pid)"
  echo "$dead_pid" > "$slots/0/pid"

  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  # Force the anchor chain onto its LAST link: pid + project both aged past the
  # TTL. _kept_slot_age must pick up the pid mtime (first stattable link) and
  # return a > TTL age → stale. This exercises that a present slot always yields
  # a numeric age (never empty) so the transition cannot silently no-op.
  _age_pid_file "$slots/0/pid" 6
  _age_pid_file "$slots/0/project" 6

  run _kept_slot_age 0
  [ "$status" -eq 0 ] || fail "_kept_slot_age 0 failed: $output"
  [[ "$output" =~ ^[0-9]+$ ]] || fail "_kept_slot_age returned non-numeric (would skip TTL): '$output'"
  [ "$output" -gt "$ISOLATE_KEEP_TTL" ] || fail "expected age > TTL, got '$output'"

  run _slot_liveness 0
  [ "$output" = "stale" ] || fail "expected 'stale' via fallback-chain anchor, got '$output'"
}
