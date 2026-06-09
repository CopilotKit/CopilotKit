#!/usr/bin/env bats
# Tests for the isolation helpers in scripts/cli/_common.sh — the --isolate
# runtime-state plumbing that lets multiple `showcase test --isolate` runs share
# one host without colliding on ports, compose project names, or scratch dirs.
#
# Three behaviors are pinned here:
#   1. Runtime state lives under XDG_STATE_HOME (NOT /tmp). The slot registry and
#      per-run scratch dir are rooted at $XDG_STATE_HOME/copilotkit/showcase, with
#      the documented $HOME/.local/state fallback when XDG_STATE_HOME is unset.
#   2. Stale slots are reaped by compose-project liveness: a slot whose recorded
#      project has no live containers is reclaimed; one with a live container is
#      left alone (so a --keep'd stack is never stolen out from under).
#   3. restore_isolation honors --keep: when keep is set it does NOT compose-down,
#      does NOT remove the run dir, does NOT release the slot, and prints a
#      survival notice (project, slot, the three +offset host ports, and the exact
#      teardown command).
#
# NB on assertion gating: bats does NOT run test bodies under `set -e` (errexit).
# Only the FINAL command's exit status decides pass/fail — a non-zero command on
# an earlier line does NOT abort the test. So a bare `[[ ... ]]` on a non-final
# line is a silent no-op. Every substantive / non-final assertion MUST be written
# `[[ ... ]] || fail "message"` so the check actually forces a hard failure (and
# supplies a diagnostic). Dropping the `|| fail` turns it into a false-green.

# fail <msg> — print the message to the bats failure stream and abort the test.
fail() {
  echo "$1" >&2
  return 1
}

setup() {
  COMMON="$BATS_TEST_DIRNAME/../cli/_common.sh"

  # ── Fake docker on PATH ────────────────────────────────────────────────────
  # apply_isolation runs `$COMPOSE_CMD down` and the reaper runs
  # `docker ps -q --filter ...`. Both must be stubbed so no real docker is hit.
  # The `ps` behavior is driven by $DOCKER_PS_OUTPUT so individual tests can make
  # a project look live (non-empty) or dead (empty).
  STUB_DIR="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$STUB_DIR"
  cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  ps)      printf '%s' "${DOCKER_PS_OUTPUT:-}"; [ -z "${DOCKER_PS_OUTPUT:-}" ] || echo ;;
  compose) : ;;  # swallow `docker compose ... down` etc.
  *)       : ;;
esac
exit 0
STUB
  chmod +x "$STUB_DIR/docker"
  PATH="$STUB_DIR:$PATH"

  # ── Fake SHOWCASE_ROOT with the two files apply_isolation rewrites ──────────
  export SHOWCASE_ROOT_OVERRIDE="$BATS_TEST_TMPDIR/root"
  mkdir -p "$SHOWCASE_ROOT_OVERRIDE/shared"
  cat > "$SHOWCASE_ROOT_OVERRIDE/shared/local-ports.json" <<'JSON'
{
  "mastra": 3104
}
JSON
  cat > "$SHOWCASE_ROOT_OVERRIDE/docker-compose.local.yml" <<'YML'
services:
  aimock:
    container_name: showcase-aimock
    ports:
      - "4010:4010"
YML

  # ── XDG state base ─────────────────────────────────────────────────────────
  export XDG_STATE_HOME="$BATS_TEST_TMPDIR/xdg"

  # Default: dead project (no live containers) unless a test overrides it.
  export DOCKER_PS_OUTPUT=""
}

# load_common — source _common.sh, then repoint the path vars at the fake root.
# _common.sh computes SHOWCASE_ROOT from its own location at source time, so we
# override the derived paths afterward to point at the per-test scratch root.
load_common() {
  # shellcheck disable=SC1090
  source "$COMMON"
  SHOWCASE_ROOT="$SHOWCASE_ROOT_OVERRIDE"
  COMPOSE_FILE="$SHOWCASE_ROOT/docker-compose.local.yml"
  PORTS_FILE="$SHOWCASE_ROOT/shared/local-ports.json"
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
}

# ── Change 1: runtime state under XDG_STATE_HOME ─────────────────────────────

@test "ISOLATE_SLOT_DIR is rooted under XDG_STATE_HOME, not /tmp" {
  load_common
  [[ "$ISOLATE_SLOT_DIR" == "$XDG_STATE_HOME/copilotkit/showcase/slots" ]] \
    || fail "ISOLATE_SLOT_DIR not under XDG_STATE_HOME: $ISOLATE_SLOT_DIR"
  # Must NOT be the old hardcoded /tmp registry path (XDG_STATE_HOME itself may
  # live under /tmp in the bats sandbox, so we pin the exact retired path).
  [[ "$ISOLATE_SLOT_DIR" != "/tmp/showcase-isolate-slots" ]] \
    || fail "ISOLATE_SLOT_DIR still the old /tmp registry: $ISOLATE_SLOT_DIR"
}

@test "state base falls back to \$HOME/.local/state when XDG_STATE_HOME unset" {
  unset XDG_STATE_HOME
  export HOME="$BATS_TEST_TMPDIR/home"
  load_common
  run _showcase_state_base
  [ "$status" -eq 0 ] || fail "_showcase_state_base failed: $output"
  [[ "$output" == "$HOME/.local/state/copilotkit/showcase" ]] \
    || fail "wrong fallback base: $output"
}

@test "per-run dir lives under XDG state runs/<name>, not /tmp" {
  load_common
  apply_isolation foo
  [[ "$ISOLATE_TMPDIR" == "$XDG_STATE_HOME/copilotkit/showcase/runs/foo" ]] \
    || fail "run dir not under XDG state runs/<name>: $ISOLATE_TMPDIR"
  # Must NOT be the old PID-keyed /tmp scratch dir.
  [[ "$ISOLATE_TMPDIR" != "${TMPDIR:-/tmp}/showcase-isolate-"* ]] \
    || fail "run dir still the old /tmp PID scratch dir: $ISOLATE_TMPDIR"
  [ -d "$ISOLATE_TMPDIR" ] || fail "run dir not created: $ISOLATE_TMPDIR"
}

# ── Change 2: stale-slot reaping by compose-project liveness ─────────────────

@test "claim reaps a slot whose project has no live containers" {
  load_common
  # Pre-seed slot 0 for a project with NO live containers (DOCKER_PS_OUTPUT="").
  mkdir -p "$XDG_STATE_HOME/copilotkit/showcase/slots/0"
  echo "ghost-proj" > "$XDG_STATE_HOME/copilotkit/showcase/slots/0/project"

  export DOCKER_PS_OUTPUT=""
  _claim_isolate_slot
  # The dead slot 0 is reaped and reclaimed by this run.
  [ "$ISOLATE_SLOT" = "0" ] || fail "expected to reclaim reaped slot 0, got: $ISOLATE_SLOT"
  # The new claim recorded ITS own project, not the ghost.
  run cat "$XDG_STATE_HOME/copilotkit/showcase/slots/0/project"
  [[ "$output" != "ghost-proj" ]] || fail "ghost project not overwritten on reclaim"
}

@test "claim does NOT reap a slot whose project has a live container" {
  load_common
  mkdir -p "$XDG_STATE_HOME/copilotkit/showcase/slots/0"
  echo "live-proj" > "$XDG_STATE_HOME/copilotkit/showcase/slots/0/project"

  # Make docker ps report a live container id -> slot 0 must be preserved.
  export DOCKER_PS_OUTPUT="abc123def456"
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "1" ] || fail "expected to skip live slot 0 and claim 1, got: $ISOLATE_SLOT"
  # Slot 0 and its project file survive untouched.
  [ -d "$XDG_STATE_HOME/copilotkit/showcase/slots/0" ] || fail "live slot 0 was wrongly reaped"
  run cat "$XDG_STATE_HOME/copilotkit/showcase/slots/0/project"
  [[ "$output" == "live-proj" ]] || fail "live slot 0 project mangled: $output"
}

@test "slot claim persists the project name alongside the pid file" {
  load_common
  apply_isolation myproj
  local slotdir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  [ -f "$slotdir/project" ] || fail "no project file written for claimed slot"
  run cat "$slotdir/project"
  [[ "$output" == "myproj" ]] || fail "wrong project recorded: $output"
  [ -f "$slotdir/pid" ] || fail "pid file no longer written"
}

# ── Change 3: restore_isolation honors --keep ────────────────────────────────

@test "restore_isolation with keep set preserves slot + run dir and prints survival notice" {
  load_common
  apply_isolation keepme
  local slotdir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  local rundir="$ISOLATE_TMPDIR"
  [ -d "$slotdir" ] || fail "precondition: slot dir missing after apply"
  [ -d "$rundir" ]  || fail "precondition: run dir missing after apply"

  keep=true
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation failed under keep: $output"

  # Nothing torn down: slot + run dir survive, slot NOT released.
  [ -d "$slotdir" ] || fail "kept slot dir was removed"
  [ -d "$rundir" ]  || fail "kept run dir was removed"

  # Survival notice content: project name, the 3 +offset host ports, teardown cmd.
  # slot 0 default name -> offset 200: aimock 4210, dashboard 3400, pocketbase 8290.
  [[ "$output" == *"keepme"* ]] || fail "notice missing project name: $output"
  [[ "$output" == *"4210"* ]] || fail "notice missing aimock host port: $output"
  [[ "$output" == *"3400"* ]] || fail "notice missing dashboard host port: $output"
  [[ "$output" == *"8290"* ]] || fail "notice missing pocketbase host port: $output"
  [[ "$output" == *"docker compose -p keepme down"* ]] \
    || fail "notice missing literal teardown command: $output"
}

@test "restore_isolation without keep removes run dir and releases slot" {
  load_common
  apply_isolation dropme
  local slotdir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  local rundir="$ISOLATE_TMPDIR"
  [ -d "$slotdir" ] || fail "precondition: slot dir missing after apply"
  [ -d "$rundir" ]  || fail "precondition: run dir missing after apply"

  keep=false
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation failed: $output"

  # NB `run` executes in a subshell, so the parent's ISOLATE_* are unchanged; we
  # assert on the filesystem effects, which DO persist across the subshell.
  [ ! -d "$rundir" ] || fail "run dir not removed on teardown: $rundir"
  [ ! -d "$slotdir" ] || fail "slot not released on teardown: $slotdir"
}
