#!/usr/bin/env bats
# REAL-SURFACE tests for `showcase reap` (Change 2) in scripts/cli/cmd-reap.sh.
# These exercise the actual failure surface the spec mandates — real leaked
# compose projects under a temp XDG_STATE_HOME, real slot records, real running
# containers and named volumes — never vi.mock-style fakes.
#
# The bug being fixed: --keep'd / crashed isolated stacks accumulate with no
# tool to list or tear them down. `showcase reap` is that tool: dry-run by
# default (lists, changes nothing), --force executes, and it NEVER touches the
# base `showcase` stack or BuildKit resources.
#
# Hermeticity: every throwaway project uses a UNIQUE disposable name
# (showcase-isotest-s3-<rand>), NEVER the base `showcase` name, and every
# stack/volume/probe container this file creates is torn down in teardown().
# We are FIXING a stack-leak bug — these tests must not leak stacks.
#
# All real-docker tests `skip` cleanly when the daemon is unreachable or the
# tiny image cannot be obtained, so the suite stays green without docker.

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
  REAP="$BATS_TEST_DIRNAME/../cli/cmd-reap.sh"

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

  # Unique disposable names for this test's throwaway stacks — NEVER `showcase`.
  RAND="${BATS_TEST_NUMBER}-$$-${RANDOM}"
  TEST_PROJ_A="showcase-isotest-s3-${RAND}-a"
  TEST_PROJ_B="showcase-isotest-s3-${RAND}-b"
  # Fake base-stack + fake-buildkit probe projects to prove the safety guards.
  FAKE_BASE="showcase"               # the reserved base project name itself
  FAKE_BASE_CTR="showcase-isotest-s3-${RAND}-fakebase"
  FAKE_BK_CTR="buildx_buildkit_showcase-isotest-s3-${RAND}"
}

teardown() {
  # Kill the live-owner helper process if a test started one.
  [ -n "${LIVE_OWNER_PID:-}" ] && kill "$LIVE_OWNER_PID" >/dev/null 2>&1 || true
  if command -v docker >/dev/null 2>&1; then
    local p
    for p in "${TEST_PROJ_A:-}" "${TEST_PROJ_B:-}"; do
      [ -n "$p" ] && docker compose -p "$p" down --remove-orphans --volumes >/dev/null 2>&1 || true
    done
    # The fake-base + fake-buildkit probe containers are plain `docker run`
    # containers (not compose stacks) — remove them by name. They are labelled
    # with com.docker.compose.project so reap's scan would SEE them, but the
    # guards must leave them standing; teardown removes them regardless.
    [ -n "${FAKE_BASE_CTR:-}" ] && docker rm -f "$FAKE_BASE_CTR" >/dev/null 2>&1 || true
    [ -n "${FAKE_BK_CTR:-}" ] && docker rm -f "$FAKE_BK_CTR" >/dev/null 2>&1 || true
    # Defensive: should NEVER exist (the base name is reserved), but if a
    # regression composed it down/up, clean any stray base-named volumes.
    docker volume ls --filter "label=com.docker.compose.project=showcase" -q 2>/dev/null \
      | grep -q . && docker compose -p showcase down --volumes >/dev/null 2>&1 || true
  fi
}

load_reap() {
  # shellcheck disable=SC1090
  source "$COMMON"
  # shellcheck disable=SC1090
  source "$REAP"
  SHOWCASE_ROOT="$SHOWCASE_ROOT_OVERRIDE"
  COMPOSE_FILE="$SHOWCASE_ROOT/docker-compose.local.yml"
  PORTS_FILE="$SHOWCASE_ROOT/shared/local-ports.json"
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
}

# Start a REAL one-container compose project + a hand-written slot record, so
# the project is a leaked iso stack reap must find. A named volume is attached
# so the volume-count + --volumes teardown are exercised.
_leak_iso_project() {
  local proj="$1" slot="$2"
  local cdir="$BATS_TEST_TMPDIR/compose-$proj"
  mkdir -p "$cdir"
  cat > "$cdir/docker-compose.yml" <<YML
services:
  keeper:
    image: $TEST_IMAGE
    command: ["sleep", "infinity"]
    volumes:
      - data:/data
volumes:
  data:
YML
  docker compose -f "$cdir/docker-compose.yml" -p "$proj" up -d >/dev/null 2>&1 || return 1
  # Slot record (the canonical pointer reap routes teardown through). A dead
  # owner pid → the slot classifies kept/stale; --force / --all reap it.
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/$slot"
  echo "$proj" > "$slots/$slot/project"
  # provably-dead pid: spawn + reap.
  local p; bash -c 'exit 0' & p=$!; wait "$p" 2>/dev/null || true
  echo "$p" > "$slots/$slot/pid"
  # A run dir, so reap's rundir removal is exercised too.
  mkdir -p "$XDG_STATE_HOME/copilotkit/showcase/runs/$proj"
}

_proj_has_container() {
  [ -n "$(docker ps -a -q --filter "label=com.docker.compose.project=$1" 2>/dev/null)" ]
}

# Stand up a REAL iso project owned by a LIVE owner: a running container PLUS a
# slot record whose pid+pid.start fingerprint a process we control and keep
# alive for the duration of the test. With running containers and an alive,
# start-time-verified owner, _slot_liveness classifies the slot as `live` — the
# "actively owned, in use" class reap must PRESERVE. The owner is a real
# backgrounded `sleep` process; its pid is recorded in LIVE_OWNER_PID and killed
# in teardown(). Returns non-zero (for `skip`) if the container won't start.
_leak_live_iso_project() {
  local proj="$1" slot="$2"
  local cdir="$BATS_TEST_TMPDIR/compose-$proj"
  mkdir -p "$cdir"
  cat > "$cdir/docker-compose.yml" <<YML
services:
  keeper:
    image: $TEST_IMAGE
    command: ["sleep", "infinity"]
    volumes:
      - data:/data
volumes:
  data:
YML
  docker compose -f "$cdir/docker-compose.yml" -p "$proj" up -d >/dev/null 2>&1 || return 1
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/$slot"
  echo "$proj" > "$slots/$slot/project"
  mkdir -p "$XDG_STATE_HOME/copilotkit/showcase/runs/$proj"
  # A REAL backgrounded process as the live owner; record a start-time-verified
  # fingerprint (pid + pid.start) so _owner_liveness reads `alive`.
  sleep 300 &
  LIVE_OWNER_PID=$!
  type _pid_start_time >/dev/null 2>&1 || source "$COMMON"
  echo "$LIVE_OWNER_PID" > "$slots/$slot/pid"
  _pid_start_time "$LIVE_OWNER_PID" > "$slots/$slot/pid.start"
}

# ── RED → GREEN: dry-run lists; --force tears down; guards hold ───────────────

@test "REAL: reap dry-run lists leaked projects and changes NOTHING (RED baseline)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  _leak_iso_project "$TEST_PROJ_A" 11 || skip "could not start throwaway project A"
  _leak_iso_project "$TEST_PROJ_B" 12 || skip "could not start throwaway project B"
  _proj_has_container "$TEST_PROJ_A" || skip "project A has no container — env issue"
  _proj_has_container "$TEST_PROJ_B" || skip "project B has no container — env issue"

  # Dry-run (no --force): both projects appear in the plan with a non-zero
  # container count, and NOTHING is torn down.
  run cmd_reap
  [ "$status" -eq 0 ] || fail "reap dry-run failed: $output"
  [[ "$output" == *"$TEST_PROJ_A"* ]] || fail "dry-run plan omitted project A: $output"
  [[ "$output" == *"$TEST_PROJ_B"* ]] || fail "dry-run plan omitted project B: $output"
  [[ "$output" == *"DRY-RUN"* ]] || fail "dry-run banner missing: $output"

  # Dry-run changed nothing — both leaked stacks still standing.
  _proj_has_container "$TEST_PROJ_A" || fail "dry-run reaped project A (must change nothing)"
  _proj_has_container "$TEST_PROJ_B" || fail "dry-run reaped project B (must change nothing)"
}

@test "REAL: reap --force tears down leaked stacks (volumes, slot, run dirs) while base showcase + buildkit are UNTOUCHED (GREEN)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  _leak_iso_project "$TEST_PROJ_A" 11 || skip "could not start throwaway project A"
  _leak_iso_project "$TEST_PROJ_B" 12 || skip "could not start throwaway project B"
  _proj_has_container "$TEST_PROJ_A" || skip "project A has no container — env issue"
  _proj_has_container "$TEST_PROJ_B" || skip "project B has no container — env issue"

  # A fake BASE-stack container, labelled exactly like the live default stack
  # (com.docker.compose.project=showcase). reap MUST NEVER touch it.
  docker run -d --name "$FAKE_BASE_CTR" \
    --label "com.docker.compose.project=showcase" \
    "$TEST_IMAGE" sleep infinity >/dev/null 2>&1 || skip "could not start fake-base probe"
  # A fake BuildKit container (buildx_buildkit_*). reap MUST NEVER touch it.
  docker run -d --name "$FAKE_BK_CTR" \
    --label "com.docker.compose.project=$FAKE_BK_CTR" \
    "$TEST_IMAGE" sleep infinity >/dev/null 2>&1 || skip "could not start fake-buildkit probe"

  # Execute. --all reaps every identified iso project regardless of TTL/keep —
  # exactly the "tear down everything isolated now" path the spec mandates.
  run cmd_reap --all --force
  [ "$status" -eq 0 ] || fail "reap --all --force failed: $output"

  # Both leaked stacks fully gone: containers, named volumes, slot + run dirs.
  _proj_has_container "$TEST_PROJ_A" && fail "project A containers survived --force"
  _proj_has_container "$TEST_PROJ_B" && fail "project B containers survived --force"
  [ -z "$(docker volume ls --filter "label=com.docker.compose.project=$TEST_PROJ_A" -q 2>/dev/null)" ] \
    || fail "project A named volume survived --force"
  [ -z "$(docker volume ls --filter "label=com.docker.compose.project=$TEST_PROJ_B" -q 2>/dev/null)" ] \
    || fail "project B named volume survived --force"
  [ ! -d "$XDG_STATE_HOME/copilotkit/showcase/slots/11" ] || fail "slot 11 dir survived --force"
  [ ! -d "$XDG_STATE_HOME/copilotkit/showcase/slots/12" ] || fail "slot 12 dir survived --force"
  [ ! -d "$XDG_STATE_HOME/copilotkit/showcase/runs/$TEST_PROJ_A" ] || fail "run dir A survived --force"
  [ ! -d "$XDG_STATE_HOME/copilotkit/showcase/runs/$TEST_PROJ_B" ] || fail "run dir B survived --force"

  # HARD SAFETY: the base-showcase container and the buildkit container are
  # STILL RUNNING — reap must never have touched them.
  [ -n "$(docker ps -q --filter "name=^${FAKE_BASE_CTR}\$" 2>/dev/null)" ] \
    || fail "reap TORE DOWN the base 'showcase' stack (catastrophic safety failure)"
  [ -n "$(docker ps -q --filter "name=^${FAKE_BK_CTR}\$" 2>/dev/null)" ] \
    || fail "reap TORE DOWN a buildx_buildkit_* container (safety failure)"
}

@test "REAL: a single named target reaps exactly that project, leaving siblings standing" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  _leak_iso_project "$TEST_PROJ_A" 11 || skip "could not start throwaway project A"
  _leak_iso_project "$TEST_PROJ_B" 12 || skip "could not start throwaway project B"
  _proj_has_container "$TEST_PROJ_A" || skip "project A has no container — env issue"
  _proj_has_container "$TEST_PROJ_B" || skip "project B has no container — env issue"

  run cmd_reap "$TEST_PROJ_A" --force
  [ "$status" -eq 0 ] || fail "single-target reap failed: $output"

  _proj_has_container "$TEST_PROJ_A" && fail "named target project A survived its reap"
  _proj_has_container "$TEST_PROJ_B" || fail "sibling project B was wrongly reaped by a single-target reap"
}

@test "REAL: single-target dry-run does NOT mislabel a harness-owned sibling as unidentified (RED→GREEN)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  # TWO real harness-owned iso projects (compose-managed, slot records). Both
  # are unambiguously harness-owned via their slot records, so NEITHER should
  # ever appear in the "Unidentified — NOT harness-owned" review listing.
  _leak_iso_project "$TEST_PROJ_A" 11 || skip "could not start throwaway project A"
  _leak_iso_project "$TEST_PROJ_B" 12 || skip "could not start throwaway project B"
  _proj_has_container "$TEST_PROJ_A" || skip "project A has no container — env issue"
  _proj_has_container "$TEST_PROJ_B" || skip "project B has no container — env issue"

  # Single-target dry-run on A. Before the fix, the unidentified listing was
  # computed against the narrowed single-target set ({A}), so harness-owned B
  # was falsely surfaced as "NOT harness-owned". After the fix, the listing is
  # computed against the FULL identification union, so B is excluded.
  run cmd_reap "$TEST_PROJ_A"
  [ "$status" -eq 0 ] || fail "single-target dry-run failed: $output"

  # Isolate the unidentified review section (everything after its warn header).
  local unident_section="${output##*Unidentified compose projects}"
  # The header is only emitted when there ARE unidentified projects; if the
  # whole output lacks it, the section is empty (the trivially-correct case).
  if [[ "$output" == *"Unidentified compose projects"* ]]; then
    [[ "$unident_section" != *"$TEST_PROJ_B"* ]] \
      || fail "harness-owned sibling B was mislabeled 'NOT harness-owned' in single-target mode: $output"
    [[ "$unident_section" != *"$TEST_PROJ_A"* ]] \
      || fail "the single target A was mislabeled 'NOT harness-owned': $output"
  fi

  # Sanity: dry-run changed nothing — both stacks still standing.
  _proj_has_container "$TEST_PROJ_A" || fail "dry-run reaped project A (must change nothing)"
  _proj_has_container "$TEST_PROJ_B" || fail "dry-run reaped project B (must change nothing)"
}

@test "REAL: an explicit target with a LIVE owner is PRESERVED (warned, not torn down) without an override" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  # A real iso project actively owned by a LIVE process (live pid+pid.start +
  # running container) → _slot_liveness reads `live`.
  _leak_live_iso_project "$TEST_PROJ_A" 11 || skip "could not start live-owner project A"
  _proj_has_container "$TEST_PROJ_A" || skip "project A has no container — env issue"
  [ "$(_slot_liveness 11)" = "live" ] || skip "project A did not classify as live — env issue"

  # Naming a LIVE-owned project explicitly must NOT silently tear it down: reap
  # preserves it and emits a loud live-owner warning naming the project.
  run cmd_reap "$TEST_PROJ_A" --force
  [ "$status" -eq 0 ] || fail "reap of live target failed unexpectedly: $output"
  _proj_has_container "$TEST_PROJ_A" \
    || fail "reap TORE DOWN a LIVE-owned explicit target without an override (safety failure): $output"
  [[ "$output" == *"$TEST_PROJ_A"* && "$output" == *"live owner"* ]] \
    || fail "no live-owner warning naming the project was emitted: $output"
  # State preserved too — slot + run dir intact.
  [ -d "$XDG_STATE_HOME/copilotkit/showcase/slots/11" ] || fail "live target's slot dir was removed"
  [ -d "$XDG_STATE_HOME/copilotkit/showcase/runs/$TEST_PROJ_A" ] || fail "live target's run dir was removed"
}

@test "REAL: an explicit LIVE target IS torn down WITH the --include-live override" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  _leak_live_iso_project "$TEST_PROJ_A" 11 || skip "could not start live-owner project A"
  _proj_has_container "$TEST_PROJ_A" || skip "project A has no container — env issue"
  [ "$(_slot_liveness 11)" = "live" ] || skip "project A did not classify as live — env issue"

  # The explicit override flag opts in to reaping a live-owner target.
  run cmd_reap "$TEST_PROJ_A" --force --include-live
  [ "$status" -eq 0 ] || fail "reap --include-live of live target failed: $output"
  _proj_has_container "$TEST_PROJ_A" \
    && fail "live target survived --include-live (override must tear it down): $output"
  [ -d "$XDG_STATE_HOME/copilotkit/showcase/slots/11" ] \
    && fail "live target's slot dir survived --include-live: $output"
  return 0
}

@test "REAL: the self-id label identifies a record-LESS orphan (no slot, no run dir)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  # A REAL compose project carrying ONLY the com.copilotkit.showcase.isolate=1
  # label apply_isolation stamps — NO slot record, NO run dir. This is the
  # user-supplied `--isolate <name>` orphan whose slot record was lost: the
  # label scan is the ONLY mechanism that can find it.
  local cdir="$BATS_TEST_TMPDIR/compose-$TEST_PROJ_A"
  mkdir -p "$cdir"
  cat > "$cdir/docker-compose.yml" <<YML
services:
  keeper:
    image: $TEST_IMAGE
    command: ["sleep", "infinity"]
    labels:
      com.copilotkit.showcase.isolate: "1"
YML
  docker compose -f "$cdir/docker-compose.yml" -p "$TEST_PROJ_A" up -d >/dev/null 2>&1 \
    || skip "could not start label-only orphan project"
  _proj_has_container "$TEST_PROJ_A" || skip "orphan has no container — env issue"

  # Identified via the label scan despite no slot record → in the plan.
  run cmd_reap
  [ "$status" -eq 0 ] || fail "reap dry-run failed: $output"
  [[ "$output" == *"$TEST_PROJ_A"* ]] || fail "label-only orphan not identified by the label scan: $output"

  # And --force reaps it (real compose project → compose down removes it).
  run cmd_reap --force
  [ "$status" -eq 0 ] || fail "reap --force failed: $output"
  _proj_has_container "$TEST_PROJ_A" && fail "label-only orphan survived --force"
  return 0
}

@test "REAL: refusing to reap the reserved base 'showcase' name as an explicit target" {
  load_reap
  run cmd_reap showcase --force
  [ "$status" -ne 0 ] || fail "reap allowed the reserved base 'showcase' target (must refuse)"
  [[ "$output" == *"showcase"* ]] || fail "refusal message should name 'showcase': $output"
}

# ── An explicit target with NOTHING to tear down must not claim a phantom reap ──
# A name with no slot record, no run dir, and (when docker is reachable) zero
# containers + zero volumes classifies `inconclusive`. Tearing it down removes
# nothing, so reap must report nothing-to-reap and count 0 — not "Reaped 1".
@test "REAL: reap --force on a nonexistent target reaps NOTHING and counts 0 (no phantom reap)" {
  load_reap
  # A syntactically valid, harness-safe, but entirely nonexistent project name.
  local missing="showcase-isotest-s3-${RAND}-ghost"
  run cmd_reap "$missing" --force
  [ "$status" -eq 0 ] || fail "reap of a nonexistent target should exit 0: $output"
  [[ "$output" == *"Reaped 1"* ]] && fail "reap claimed a phantom teardown (Reaped 1) for a nonexistent target: $output"
  [[ "$output" == *"Nothing to reap"* ]] \
    || fail "reap should report nothing-to-reap for a nonexistent target: $output"
}

# A REAL existing target must still report reaped:1 (happy path preserved).
@test "REAL: reap --force on a REAL existing target still counts it as reaped (happy path)" {
  _docker_ok || skip "docker daemon unavailable"
  _ensure_test_image || skip "cannot obtain $TEST_IMAGE"
  load_reap

  _leak_iso_project "$TEST_PROJ_A" 11 || skip "could not start throwaway project A"
  _proj_has_container "$TEST_PROJ_A" || skip "project A has no container — env issue"

  run cmd_reap "$TEST_PROJ_A" --force
  [ "$status" -eq 0 ] || fail "single-target reap failed: $output"
  [[ "$output" == *"Reaped 1"* ]] || fail "real target should report Reaped 1: $output"
  _proj_has_container "$TEST_PROJ_A" && fail "real target survived its reap"
  return 0
}
