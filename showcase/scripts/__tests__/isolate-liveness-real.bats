#!/usr/bin/env bats
# REAL-SURFACE liveness tests for the Change-1 false-positive fix in
# scripts/cli/_common.sh. Unlike isolate.bats (which drives a docker STUB),
# these tests exercise the actual failure surface the spec mandates:
#
#   * real slot dirs under a temp XDG_STATE_HOME,
#   * a real DEAD owning PID (spawn `sleep` then `wait` for it to exit —
#     provably dead via kill -0),
#   * a REAL one-container `docker compose` project so containers ARE running.
#
# The bug: when a slot's recorded compose project has RUNNING containers, the
# old _slot_liveness short-circuited to `live` BEFORE checking the owning PID.
# A --keep'd stack (owner process exited, containers still up) was therefore
# classified `live` forever and never reaped → unbounded slot accumulation.
# The fix introduces the `kept` state (running containers + dead/unverifiable
# owner) and a start-time-verified owner probe.
#
# Hermeticity: every throwaway compose project uses a UNIQUE disposable name
# (showcase-isotest-s1-<rand>), NEVER the base `showcase` name, and is torn
# down in teardown() with `docker compose -p <name> down --remove-orphans
# --volumes`. We are fixing a stack-leak bug — these tests must not leak stacks.
#
# All real-docker tests `skip` cleanly when the docker daemon is unreachable or
# the tiny test image cannot be obtained, so the suite stays green on hosts /
# CI runners without docker.

fail() {
  echo "$1"
  return 1
}

# The tiny image the throwaway one-container project runs. Pinned digest-free
# but version-tagged; pulled in setup() if absent. `sleep infinity` keeps the
# container RUNNING so `docker ps -q --filter label=...` reports it.
TEST_IMAGE="alpine:3.20"

# _docker_ok — true when a docker daemon is reachable. Used to skip the
# real-docker tests on hosts/CI without docker.
_docker_ok() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 || return 1
  return 0
}

# _ensure_test_image — make sure $TEST_IMAGE exists locally, pulling once if
# needed. Returns nonzero (→ caller skips) when it cannot be obtained.
_ensure_test_image() {
  docker image inspect "$TEST_IMAGE" >/dev/null 2>&1 && return 0
  docker pull "$TEST_IMAGE" >/dev/null 2>&1
}

setup() {
  COMMON="$BATS_TEST_DIRNAME/../cli/_common.sh"

  # Real XDG state root (no docker stub on PATH — these tests use REAL docker).
  export XDG_STATE_HOME="$BATS_TEST_TMPDIR/xdg"

  # Minimal real SHOWCASE_ROOT so _slot_offset_ports has a ports file to read
  # (we override the function per-test anyway, but load_common references it).
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

  # Unique disposable project name for this test's throwaway stack — NEVER the
  # base `showcase` name. Recorded so teardown() can compose it down even if
  # the test aborts mid-way.
  TEST_PROJ="showcase-isotest-s1-${BATS_TEST_NUMBER}-$$-${RANDOM}"
  TEST_PORT=""   # set by the tests that bind a host port; torn down in teardown
}

teardown() {
  # Tear down the throwaway stack unconditionally (the stack-leak guarantee):
  # remove containers, orphans, and named volumes for the unique project.
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

# _start_real_project <proj> [host_port] — start a REAL one-container compose
# project named <proj> running `sleep infinity` (so the container is RUNNING
# and carries the com.docker.compose.project=<proj> label). If host_port is
# given, the container publishes it (binds a real host listener) so the
# port-probe tests have a genuine docker-held port to exercise lsof against.
_start_real_project() {
  local proj="$1" host_port="${2:-}"
  local cdir="$BATS_TEST_TMPDIR/compose-$proj"
  mkdir -p "$cdir"
  if [ -n "$host_port" ]; then
    cat > "$cdir/docker-compose.yml" <<YML
services:
  keeper:
    image: $TEST_IMAGE
    command: ["sleep", "infinity"]
    ports:
      - "127.0.0.1:${host_port}:9"
YML
  else
    cat > "$cdir/docker-compose.yml" <<YML
services:
  keeper:
    image: $TEST_IMAGE
    command: ["sleep", "infinity"]
YML
  fi
  docker compose -f "$cdir/docker-compose.yml" -p "$proj" up -d >/dev/null 2>&1
}

# _make_dead_pid — spawn a short-lived process, wait for it to exit, and echo
# its (now dead) pid. Skips the test if the OS recycled the pid to a live
# process between wait and the check (the dead-owner fixture would be invalid).
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

# ── Change 1: liveness false-positive (the FOUNDATION) ───────────────────────

@test "REAL: a kept stack (dead owner + running containers) classifies kept, not live" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  # Recorded project + a provably DEAD owner pid (no pid.start → unverifiable
  # even if the number were alive). This is exactly a --keep'd stack: the
  # owning `showcase test --keep` process has exited, the containers live on.
  echo "$TEST_PROJ" > "$slots/0/project"
  local dead_pid
  dead_pid="$(_make_dead_pid)"
  echo "$dead_pid" > "$slots/0/pid"

  # Real running container under the recorded project name.
  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  # Sanity: docker really does report a running container for this project.
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  # GREEN expectation (fix in place): the container check wins, but the owner
  # is dead → kept, NOT live. The PID column annotates the dead owner.
  run _slot_liveness 0
  [ "$status" -eq 0 ] || fail "_slot_liveness 0 failed: $output"
  [ "$output" = "kept" ] \
    || fail "expected liveness 'kept' for dead-owner+running-containers slot, got '$output' (pre-fix bug returns 'live')"

  # _slot_state's PID column shows <pid>(dead), and LIVE=kept — never a bare
  # numeric PID with LIVE=live (the exact false-positive from the bug report).
  run _slot_state 0
  [ "$status" -eq 0 ] || fail "_slot_state 0 failed: $output"
  local -a fields
  IFS='|' read -ra fields <<< "$output"
  [ "${fields[2]}" = "${dead_pid}(dead)" ] \
    || fail "expected PID column '${dead_pid}(dead)', got '${fields[2]}' (pre-fix bug shows bare '$dead_pid')"
  [ "${fields[3]}" = "kept" ] \
    || fail "expected LIVE column 'kept', got '${fields[3]}' (pre-fix bug shows 'live')"
}

@test "REAL: a live, start-time-verified owner with running containers stays live" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "$TEST_PROJ" > "$slots/0/project"
  # LIVE owner: this bats process, with a matching pid.start fingerprint.
  echo "$$" > "$slots/0/pid"
  _pid_start_time "$$" > "$slots/0/pid.start"

  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  # A live verified owner UPGRADES kept → live (protect indefinitely).
  run _slot_liveness 0
  [ "$status" -eq 0 ] || fail "_slot_liveness 0 failed: $output"
  [ "$output" = "live" ] \
    || fail "expected 'live' for verified-live-owner+running-containers, got '$output'"
}

@test "REAL: a reused owner PID with running containers is kept, not live (reuse guard)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "$TEST_PROJ" > "$slots/0/project"
  # Reuse hazard: the recorded pid is THIS live process, but the recorded
  # start-time fingerprint belongs to a DIFFERENT (now-gone) process. The
  # start-time guard must catch the mismatch and treat the owner as gone.
  echo "$$" > "$slots/0/pid"
  echo "definitely-not-our-start-time" > "$slots/0/pid.start"

  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  run _slot_liveness 0
  [ "$status" -eq 0 ] || fail "_slot_liveness 0 failed: $output"
  [ "$output" = "kept" ] \
    || fail "expected 'kept' for reused-PID+running-containers (start-time mismatch), got '$output'"

  # And the table flags the reuse explicitly.
  run _slot_state 0
  local -a fields
  IFS='|' read -ra fields <<< "$output"
  [ "${fields[2]}" = "$$(reused)" ] \
    || fail "expected PID column '$$(reused)', got '${fields[2]}'"
}

@test "REAL: sweep leaves a kept stack standing but reaps it once classified stale" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_common

  local base="$XDG_STATE_HOME/copilotkit/showcase"
  local slots="$base/slots"
  mkdir -p "$slots/0"
  echo "$TEST_PROJ" > "$slots/0/project"
  local dead_pid
  dead_pid="$(_make_dead_pid)"
  echo "$dead_pid" > "$slots/0/pid"

  _start_real_project "$TEST_PROJ" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"

  # Part 1: a sweep must NOT reap a kept slot (Change 1 — no TTL yet, kept is
  # always protected). The claim runs a sweep opportunistically.
  _claim_isolate_slot
  [ -d "$slots/0" ] || fail "sweep reaped a kept stack (dead owner + RUNNING containers)"
  run cat "$slots/0/project"
  [ "$output" = "$TEST_PROJ" ] || fail "kept slot 0 project mangled after sweep: $output"
  # The claim landed on slot 1 (slot 0 reserved + kept-protected).
  [ "$ISOLATE_SLOT" != "0" ] || fail "claim landed on the protected kept slot 0"

  # Part 2: once the containers are gone, the same slot classifies stale and a
  # sweep reaps it (this is the existing stopped-keeper reclamation path, now
  # routed through the kept→(no containers)→stale transition). Compose the
  # throwaway project down so no RUNNING containers protect it anymore.
  docker compose -p "$TEST_PROJ" down --remove-orphans --volumes >/dev/null 2>&1 || true
  run _slot_liveness 0
  [ "$status" -eq 0 ] || fail "_slot_liveness 0 failed after teardown: $output"
  [ "$output" = "stale" ] \
    || fail "expected 'stale' for dead owner + NO running containers, got '$output'"
}

# ── Change 1b: _slot_ports_free own-port regression (the rename hazard) ──────

@test "REAL: pinned claim onto a kept slot treats its OWN container ports as own (not foreign)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  command -v lsof >/dev/null 2>&1 || skip "lsof required for the port-probe path"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  # Pin slot 9. Constrain the probed port set to a SINGLE deterministic host
  # port (override _slot_offset_ports for slot 9) so the test exercises the
  # own-project filter against a real docker-held listener without flaking on
  # whatever else happens to be bound on this host. real lsof + real docker ps
  # still drive the filter decision.
  TEST_PORT=39619
  _slot_offset_ports() { printf '%d\n' "$TEST_PORT"; }

  mkdir -p "$slots/9"
  echo "$TEST_PROJ" > "$slots/9/project"
  local dead_pid
  dead_pid="$(_make_dead_pid)"
  echo "$dead_pid" > "$slots/9/pid"   # dead owner → this is a KEPT stack

  # Real container holding the slot's (overridden) offset port on the host.
  _start_real_project "$TEST_PROJ" "$TEST_PORT" || skip "could not start throwaway compose project"
  [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$TEST_PROJ")" ] \
    || skip "throwaway project has no running container — environment issue"
  # Confirm the host port really is held (by docker) before asserting the filter.
  lsof -nP -i :"$TEST_PORT" -sTCP:LISTEN >/dev/null 2>&1 \
    || skip "host port $TEST_PORT not observed as LISTEN — docker port-publish unavailable in this env"

  # Liveness is `kept` (dead owner + running containers). With the own-project
  # filter widened to live OR kept, the kept slot's own docker listener on its
  # own port is NOT a foreign hold → _slot_ports_free returns 0 (free).
  run _slot_liveness 9
  [ "$output" = "kept" ] || fail "precondition: slot 9 should be 'kept', got '$output'"

  run _slot_ports_free 9
  [ "$status" -eq 0 ] \
    || fail "kept slot's OWN docker port treated as foreign (pre-fix bug): status=$status output=$output"

  # End-to-end: a pinned claim onto the kept slot must NOT die "ports are held
  # by a foreign process". The pinned EEXIST path reaps stale/inconclusive and
  # retries — but `kept` is neither, so it reaches the port probe, which now
  # accepts its own ports. (Pre-fix: liveness=='live'-only filter → die.)
  export SHOWCASE_ISO_SLOT=9
  run _claim_isolate_slot
  [ "$status" -eq 0 ] \
    || fail "pinned claim onto kept slot died (own ports seen as foreign): $output"
  [[ "$output" != *"held by a foreign process"* ]] \
    || fail "pinned claim reported its own kept-stack ports as foreign: $output"
}

@test "REAL: a foreign (non-docker) listener on a slot's port is still seen as held" {
  _docker_ok || skip "docker daemon unavailable"
  command -v lsof >/dev/null 2>&1 || skip "lsof required for the port-probe path"
  command -v python3 >/dev/null 2>&1 || skip "python3 used to bind a real foreign listener"
  load_common

  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  TEST_PORT=39620
  _slot_offset_ports() { printf '%d\n' "$TEST_PORT"; }

  mkdir -p "$slots/9"
  echo "$TEST_PROJ" > "$slots/9/project"
  echo "$$" > "$slots/9/pid"
  _pid_start_time "$$" > "$slots/9/pid.start"   # live verified owner → liveness 'live'

  # Bind the port with a REAL non-docker process (python3) so the own-project
  # docker filter does NOT apply — it must be reported as a foreign hold even
  # though the slot's own liveness is live/kept.
  python3 -c "
import socket, time, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', $TEST_PORT))
s.listen(1)
sys.stderr.write('bound\n'); sys.stderr.flush()
time.sleep(30)
" 2>"$BATS_TEST_TMPDIR/binder.err" &
  local binder_pid=$!
  # Wait for the binder to actually be listening (poll up to ~3s).
  local i=0
  while [ $i -lt 30 ]; do
    if lsof -nP -i :"$TEST_PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.1; i=$((i+1))
  done
  if ! lsof -nP -i :"$TEST_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    kill "$binder_pid" 2>/dev/null || true
    skip "could not bind foreign listener on $TEST_PORT"
  fi

  run _slot_ports_free 9
  local rc="$status"
  kill "$binder_pid" 2>/dev/null || true
  wait "$binder_pid" 2>/dev/null || true

  [ "$rc" -ne 0 ] \
    || fail "a foreign (non-docker) listener on the slot's port was wrongly treated as free"
}
