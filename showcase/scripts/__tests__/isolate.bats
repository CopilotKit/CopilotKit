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
#   3. restore_isolation honors --keep: when ISOLATE_KEEP is set it does NOT
#      compose-down, does NOT remove the run dir, does NOT release the slot, and
#      prints a survival notice (project, slot, the three +offset host ports, and
#      the exact teardown command). ISOLATE_KEEP must be a GLOBAL that survives
#      cmd_test returning — the EXIT trap fires at top-level exit, where a
#      function-local flag has already unwound.
#
# NB on assertion style: bats-core runs test bodies with errexit semantics
# (`set -eET` plus an ERR trap), so a bare `[[ ... ]]` that fails DOES fail the
# test — even on a non-final line. We still write assertions as
# `[[ ... ]] || fail "message"` for the diagnostic message on failure, and for
# robustness in contexts where errexit is suppressed (e.g. inside && / ||
# chains or condition positions).

# fail <msg> — print the message and abort the test. The message goes to
# STDOUT: bats reliably displays a failed test's stdout, but not its stderr.
fail() {
  echo "$1"
  return 1
}

# require_python3 — skip tests that drive apply_isolation through its real
# python3 ports/compose rewriters; without this, a python3-less machine fails
# those tests with a bare "command not found" instead of a clear skip.
require_python3() {
  command -v python3 >/dev/null 2>&1 || skip "python3 required (apply_isolation rewrites ports/compose files with it)"
}

# _touch_age <seconds-ago> <path> — backdate a path's mtime portably. BSD
# touch has no GNU-style `-d '-N seconds'`; compute the absolute `-t` stamp
# with python3 instead (callers must require_python3). DST-safe: the stamp is
# computed in UTC (time.gmtime) and interpreted in UTC (TZ=UTC for touch) —
# a localtime stamp straddling a DST transition would be off by an hour (or
# land in a nonexistent/ambiguous wall-clock time).
_touch_age() {
  local stamp
  stamp="$(python3 -c "import time; print(time.strftime('%Y%m%d%H%M.%S', time.gmtime(time.time() - $1)))")"
  TZ=UTC touch -t "$stamp" "$2"
}

# _assert_stub_sentinel_logged — prove the docker-stub→DOCKER_LOG pipeline is
# alive before drawing any conclusion from the log's contents. Several tests
# assert the ABSENCE of compose-down lines; without this sentinel, a silently
# broken pipeline (DOCKER_LOG unset/unwritable in the child, an export
# regression, the stub falling off PATH) makes those absence checks pass
# vacuously — "no evidence of wrongdoing" instead of "verified right-doing".
# Each caller runs `docker version` before the code under test (and after any
# log truncation); this asserts that invocation actually landed in the log.
_assert_stub_sentinel_logged() {
  [ -f "$DOCKER_LOG" ] \
    || fail "docker stub log missing — stub/DOCKER_LOG pipeline broken, absence assertions would be vacuous"
  grep -qx "version" "$DOCKER_LOG" \
    || fail "sentinel 'docker version' invocation not logged — stub/DOCKER_LOG pipeline broken: $(cat "$DOCKER_LOG")"
}

setup() {
  COMMON="$BATS_TEST_DIRNAME/../cli/_common.sh"

  # ── Fake docker on PATH ────────────────────────────────────────────────────
  # apply_isolation runs `$COMPOSE_CMD down` and the reaper runs
  # `docker ps -q --filter ...`. Both must be stubbed so no real docker is hit.
  # The `ps` behavior is driven by $DOCKER_PS_OUTPUT so individual tests can make
  # a project look live (non-empty) or dead (empty), and by $DOCKER_PS_EXIT so
  # tests can simulate a docker daemon failure (non-zero exit, no output).
  # `compose ... down` failure is driven by $DOCKER_COMPOSE_DOWN_EXIT so tests
  # can simulate a teardown that leaves the stack standing.
  STUB_DIR="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$STUB_DIR"
  cat > "$STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
# Record every invocation so tests can assert on WHICH compose commands ran
# (e.g. that a failed --isolate never composes down the default stack).
printf '%s\n' "$*" >> "${DOCKER_LOG:-/dev/null}"
case "$1" in
  ps)
    [ "${DOCKER_PS_EXIT:-0}" -eq 0 ] || exit "${DOCKER_PS_EXIT}"
    printf '%s' "${DOCKER_PS_OUTPUT:-}"; [ -z "${DOCKER_PS_OUTPUT:-}" ] || echo ;;
  compose)
    # Ordering probe: when REAP_ORDER_CHECK_DIR is set, snapshot whether that
    # dir still exists at the moment a compose-down is invoked. Lets tests pin
    # "compose-down runs BEFORE state deletion" (the reap's split-brain
    # guarantee) instead of only "compose-down ran at some point".
    if [[ " $* " == *" down "* ]] && [ -n "${REAP_ORDER_CHECK_DIR:-}" ]; then
      if [ -d "$REAP_ORDER_CHECK_DIR" ]; then
        echo "REAP_ORDER_CHECK dir-present" >> "${DOCKER_LOG:-/dev/null}"
      else
        echo "REAP_ORDER_CHECK dir-absent" >> "${DOCKER_LOG:-/dev/null}"
      fi
    fi
    # Match `down` as a discrete word: a bare *" down"* substring also matches
    # the PROJECT NAME in `--project-name downfail`, silently failing commands
    # that never ran `down` at all. Space-padding "$*" makes the word check
    # exact whether `down` is interior or the final argument.
    if [[ " $* " == *" down "* ]] && [ "${DOCKER_COMPOSE_DOWN_EXIT:-0}" -ne 0 ]; then
      echo "stub: compose down failed" >&2
      exit "${DOCKER_COMPOSE_DOWN_EXIT}"
    fi ;;  # otherwise swallow `docker compose ...` quietly
  *)       : ;;
esac
exit 0
STUB
  chmod +x "$STUB_DIR/docker"
  PATH="$STUB_DIR:$PATH"

  # Invocation log for the docker stub (one line per call, "$*"-joined args).
  export DOCKER_LOG="$BATS_TEST_TMPDIR/docker-invocations.log"

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

  # Default: dead project (no live containers), healthy docker daemon, compose
  # down succeeds, unless a test overrides them.
  export DOCKER_PS_OUTPUT=""
  export DOCKER_PS_EXIT=0
  export DOCKER_COMPOSE_DOWN_EXIT=0
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
  # (Regression note: the pre-XDG registry lived at /tmp/showcase-isolate-slots;
  # the exact-path equality above already rules that out.)
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
  require_python3
  load_common
  apply_isolation foo
  [[ "$ISOLATE_TMPDIR" == "$XDG_STATE_HOME/copilotkit/showcase/runs/foo" ]] \
    || fail "run dir not under XDG state runs/<name>: $ISOLATE_TMPDIR"
  # (Regression note: the pre-XDG scratch dir was the PID-keyed
  # ${TMPDIR:-/tmp}/showcase-isolate-<pid>; the exact-path equality above
  # already rules that out.)
  [ -d "$ISOLATE_TMPDIR" ] || fail "run dir not created: $ISOLATE_TMPDIR"
}

# ── Change 2: stale-slot reaping by compose-project liveness ─────────────────

@test "claim reaps a slot whose project has no live containers and no live owning PID" {
  load_common
  # Pre-seed slot 0 for a project with NO live containers (DOCKER_PS_OUTPUT="")
  # and NO pid file (so there is no live owning PID to protect it either —
  # under the three-signal order, the ABSENCE of live containers alone is not
  # enough to reap while the owning process is still alive).
  mkdir -p "$XDG_STATE_HOME/copilotkit/showcase/slots/0"
  echo "ghost-proj" > "$XDG_STATE_HOME/copilotkit/showcase/slots/0/project"

  export DOCKER_PS_OUTPUT=""
  _claim_isolate_slot
  # The dead slot 0 is reaped and reclaimed by this run.
  [ "$ISOLATE_SLOT" = "0" ] || fail "expected to reclaim reaped slot 0, got: $ISOLATE_SLOT"
  # The reap rm -rf'd the ghost slot dir: only apply_isolation (not the claim)
  # writes a project file, so after a genuine reap+reclaim the ghost project
  # file must be GONE. (A `run cat`+`!= ghost-proj` check here would pass
  # vacuously on empty output even if the reap never happened.)
  [ ! -f "$XDG_STATE_HOME/copilotkit/showcase/slots/0/project" ] \
    || fail "ghost project file survived the reap"
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
  [ "$status" -eq 0 ] || fail "live slot 0 project file missing"
  [[ "$output" == "live-proj" ]] || fail "live slot 0 project mangled: $output"
}

@test "slot claim persists the project name alongside the pid file" {
  require_python3
  load_common
  apply_isolation myproj
  local slotdir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  [ -f "$slotdir/project" ] || fail "no project file written for claimed slot"
  run cat "$slotdir/project"
  [ "$status" -eq 0 ] || fail "project file unreadable"
  [[ "$output" == "myproj" ]] || fail "wrong project recorded: $output"
  [ -f "$slotdir/pid" ] || fail "pid file no longer written"
}

@test "claim does NOT reap a project-recorded slot with zero containers but a LIVE owning PID" {
  # The claim/start race: apply_isolation writes the project file minutes before
  # any container exists (image builds happen later). Zero live containers must
  # NOT be authoritative while the owning process is still alive.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "racer-proj" > "$slots/0/project"
  echo "$$" > "$slots/0/pid"   # this bats process — definitely alive

  export DOCKER_PS_OUTPUT=""   # no containers yet (still building)
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "1" ] || fail "live-owner slot 0 was stolen; claimed: $ISOLATE_SLOT"
  [ -d "$slots/0" ] || fail "live-owner slot 0 was reaped"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "slot 0 project file missing after sweep"
  [[ "$output" == "racer-proj" ]] || fail "slot 0 project mangled: $output"
}

@test "claim leaves a project-recorded slot alone when docker ps fails" {
  # A docker daemon failure must read as "cannot verify", never as "no
  # containers" — otherwise a daemon hiccup mass-reaps live slots.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "unknowable-proj" > "$slots/0/project"

  export DOCKER_PS_EXIT=1
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "1" ] || fail "unverifiable slot 0 was claimed: $ISOLATE_SLOT"
  [ -d "$slots/0" ] || fail "slot 0 reaped despite docker ps failure"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "slot 0 project file missing after sweep"
  [[ "$output" == "unknowable-proj" ]] || fail "slot 0 project mangled: $output"
}

@test "legacy slot without project file survives set -e and is reaped via dead-PID fallback" {
  # bin/showcase runs `set -euo pipefail` and sources _common.sh; a slot dir
  # with no project file must not kill the script (cat exits 1), and the
  # documented PID fallback must actually reap it.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"   # legacy: NO project file
  bash -c 'exit 0' &
  local dead_pid=$!
  wait "$dead_pid" || true
  # PID-reuse guard: the fixture's premise is a DEAD owning pid; if the OS
  # recycled it to a live process between wait and the sweep, skip rather than
  # flake.
  if kill -0 "$dead_pid" 2>/dev/null; then
    skip "PID $dead_pid was recycled to a live process — dead-PID fixture invalid"
  fi
  echo "$dead_pid" > "$slots/0/pid"

  run bash -euo pipefail -c "source '$COMMON'; _claim_isolate_slot; echo \"CLAIMED=\$ISOLATE_SLOT\""
  [ "$status" -eq 0 ] || fail "script died under set -euo pipefail on legacy slot: $output"
  [[ "$output" == *"CLAIMED=0"* ]] || fail "dead legacy slot 0 not reaped/reclaimed: $output"
}

@test "claim does NOT reap a kept-stack slot (owner dead, containers live)" {
  # --keep leaves the stack standing after the owning process exits; container
  # liveness alone must keep protecting the slot.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "keeper-proj" > "$slots/0/project"
  bash -c 'exit 0' &
  local dead_pid=$!
  wait "$dead_pid" || true
  # PID-reuse guard (see the legacy-slot test above): a recycled live pid
  # would invalidate the dead-owner premise.
  if kill -0 "$dead_pid" 2>/dev/null; then
    skip "PID $dead_pid was recycled to a live process — dead-PID fixture invalid"
  fi
  echo "$dead_pid" > "$slots/0/pid"

  export DOCKER_PS_OUTPUT="abc123def456"   # containers still up
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "1" ] || fail "kept-stack slot 0 was stolen: $ISOLATE_SLOT"
  [ -d "$slots/0" ] || fail "kept-stack slot 0 was reaped"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "kept-stack project file missing after sweep"
  [[ "$output" == "keeper-proj" ]] || fail "kept-stack project mangled: $output"
}

@test "claim reaps an over-age legacy slot whose pid file is empty (inconclusive)" {
  # An empty/garbage pid file used to dodge BOTH the pid check and the
  # `[ ! -f pid ]`-gated age fallback, leaking the slot forever.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"   # legacy: no project file
  : > "$slots/0/pid"    # empty pid file → pid check inconclusive
  touch -t 202001010000 "$slots/0"   # mtime far beyond the 2h threshold

  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "0" ] || fail "empty-pid over-age slot 0 leaked; claimed: $ISOLATE_SLOT"
}

@test "claim does NOT reap a RECENT project-recorded slot whose pid file is garbage (inconclusive)" {
  # Truncated-pid-write race: a live owner mid-build (project recorded, zero
  # containers yet) whose pid file write was truncated/corrupted must NOT lose
  # its slot — "no live owner" was never actually verified. An unreadable/
  # empty/non-numeric pid is INCONCLUSIVE and must fall through to the age
  # fallback; a RECENT slot therefore survives the sweep.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "truncated-proj" > "$slots/0/project"
  echo "not-a-pid" > "$slots/0/pid"   # garbage contents — pid check inconclusive

  export DOCKER_PS_OUTPUT=""   # zero containers (still building)
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "1" ] || fail "inconclusive-pid slot 0 was stolen; claimed: $ISOLATE_SLOT"
  [ -d "$slots/0" ] || fail "inconclusive-pid slot 0 was reaped"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "slot 0 project file missing after sweep"
  [[ "$output" == "truncated-proj" ]] || fail "slot 0 project mangled: $output"
}

@test "claim reaps an OVER-AGE project-recorded slot whose pid file is garbage via the age fallback" {
  # Companion to the test above: inconclusive-pid slots are not protected
  # FOREVER — the age fallback still reclaims them (and their runs/<project>
  # scratch dir) once they exceed ISOLATE_STALE_THRESHOLD.
  load_common
  local base="$XDG_STATE_HOME/copilotkit/showcase"
  local slots="$base/slots"
  mkdir -p "$slots/0"
  echo "truncated-proj" > "$slots/0/project"
  echo "not-a-pid" > "$slots/0/pid"
  mkdir -p "$base/runs/truncated-proj"
  touch -t 202001010000 "$slots/0"   # mtime far beyond the 2h threshold

  export DOCKER_PS_OUTPUT=""
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "0" ] || fail "over-age inconclusive-pid slot 0 leaked; claimed: $ISOLATE_SLOT"
  [ ! -f "$slots/0/project" ] || fail "ghost project record survived the age-fallback reap"
  [ ! -d "$base/runs/truncated-proj" ] || fail "orphan run dir leaked: $base/runs/truncated-proj"
}

@test "reaping a dead slot also removes its runs/<project> scratch dir" {
  # Orphan-leak regression: the sweep used to remove only the slot dir; the
  # crashed run's runs/<project> scratch dir was cleaned by NOTHING (the owner
  # is dead, and restore_isolation only removes the CURRENT run's dir), so
  # orphans accumulated under XDG state forever.
  load_common
  local base="$XDG_STATE_HOME/copilotkit/showcase"
  mkdir -p "$base/slots/0"
  echo "ghost-proj" > "$base/slots/0/project"   # dead project, no pid file
  mkdir -p "$base/runs/ghost-proj"
  touch "$base/runs/ghost-proj/docker-compose.local.yml"

  export DOCKER_PS_OUTPUT=""   # no live containers → project-stale reap
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "0" ] || fail "expected to reclaim reaped slot 0, got: $ISOLATE_SLOT"
  [ ! -f "$base/slots/0/project" ] || fail "ghost slot 0 was not reaped"
  [ ! -d "$base/runs/ghost-proj" ] || fail "orphan run dir leaked: $base/runs/ghost-proj"
  # The sweep released its own lock on the way out.
  [ ! -d "$base/slots/.sweep.lock" ] || fail "sweep lock left behind after a normal sweep"
}

@test "reaping a dead slot composes the project down before deleting its state" {
  # Stopped-but-present remnants: container-liveness protection is RUNNING
  # containers only (docker ps -q). A --keep'd stack whose containers were
  # stopped (manual docker stop, daemon restart, host reboot) reaches the reap
  # with stopped containers and named volumes still present — deleting the run
  # dir + slot while those remain would strand them with no compose state
  # (split-brain). The reap must therefore attempt a best-effort, project-
  # labeled compose-down FIRST.
  load_common
  local base="$XDG_STATE_HOME/copilotkit/showcase"
  mkdir -p "$base/slots/0"
  echo "stopped-keeper" > "$base/slots/0/project"   # validated record, no pid file
  mkdir -p "$base/runs/stopped-keeper"

  export DOCKER_PS_OUTPUT=""   # containers stopped → no RUNNING ones → reap path
  # Ordering probe (see the stub): snapshot the runs dir's existence at
  # compose-down time, so "down BEFORE state deletion" is pinned directly.
  export REAP_ORDER_CHECK_DIR="$base/runs/stopped-keeper"
  : > "$DOCKER_LOG"
  docker version
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "0" ] || fail "expected to reclaim reaped slot 0, got: $ISOLATE_SLOT"
  [ ! -f "$base/slots/0/project" ] || fail "ghost project record survived the reap"
  [ ! -d "$base/runs/stopped-keeper" ] || fail "runs dir survived the reap"
  # The remnant cleanup ran: a project-labeled compose down carrying --volumes.
  _assert_stub_sentinel_logged
  run grep -E -- "compose -p stopped-keeper down --remove-orphans --volumes" "$DOCKER_LOG"
  [ "$status" -eq 0 ] \
    || fail "reap did not compose the dead project down: $(cat "$DOCKER_LOG")"
  # …and it ran BEFORE the state deletion: the runs dir still existed when the
  # down was invoked (deleting state first would strand stopped containers /
  # named volumes with no compose state — the split-brain the order prevents).
  run grep -qx -- "REAP_ORDER_CHECK dir-present" "$DOCKER_LOG"
  [ "$status" -eq 0 ] \
    || fail "compose-down ran AFTER the runs dir was deleted (reap order regression): $(cat "$DOCKER_LOG")"
}

@test "a slot whose project record fails the traversal guard is left intact for inspection" {
  # Path-traversal guard vs. orphaning: a corrupted/tampered project record
  # (e.g. "../..") must never be interpolated into rm -rf — but the OLD code
  # still rm -rf'd the SLOT dir, destroying the only pointer to whatever runs
  # dir the record names. The guard now leaves the whole slot in place for
  # manual inspection instead of half-destroying the evidence.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  printf '%s\n' '../evil' > "$slots/0/project"   # fails [a-z0-9][a-z0-9_-]*

  export DOCKER_PS_OUTPUT=""   # no live containers, no pid file → reap path
  _claim_isolate_slot
  # The suspicious slot survives — with its record — and the claim moves on.
  [ "$ISOLATE_SLOT" = "1" ] || fail "expected slot 1 (suspicious slot 0 preserved), got: $ISOLATE_SLOT"
  [ -d "$slots/0" ] || fail "suspicious slot 0 was reaped (record/evidence destroyed)"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "suspicious slot 0 record removed"
  [[ "$output" == "../evil" ]] || fail "suspicious record mangled: $output"
}

@test "a fresh pre-existing .sweep.lock skips the sweep; claiming still succeeds" {
  # TOCTOU sweep/claim race: two concurrent claimants could both observe slot 0
  # stale — A reaps + re-claims it, then B reaps A's FRESH claim and claims the
  # same slot (two owners, identical port offsets). The sweep is serialized by
  # a .sweep.lock dir; a held (fresh) lock means another process is already
  # sweeping, so this claimant must SKIP the sweep — the stale-looking slot
  # survives — and proceed straight to claiming a free slot.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "ghost-proj" > "$slots/0/project"   # stale-looking: dead project, no pid
  mkdir -p "$slots/.sweep.lock"            # fresh lock — sweeper "active"

  export DOCKER_PS_OUTPUT=""
  _claim_isolate_slot
  # Sweep skipped: the stale-looking slot 0 survives untouched…
  [ -d "$slots/0" ] || fail "sweep ran despite a held .sweep.lock"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "slot 0 project file missing after skipped sweep"
  [[ "$output" == "ghost-proj" ]] || fail "slot 0 project mangled: $output"
  # …and the claim proceeds to the next free slot (lock name never collides
  # with the numeric claim loop).
  [ "$ISOLATE_SLOT" = "1" ] || fail "expected slot 1 with sweep skipped, got: $ISOLATE_SLOT"
  # The foreign sweeper's fresh lock is not ours to remove.
  [ -d "$slots/.sweep.lock" ] || fail "foreign (fresh) sweep lock was removed"
}

@test "an over-age .sweep.lock is taken over and the sweep proceeds" {
  # Crashed-sweeper recovery, with the DEDICATED lock threshold: the lock is
  # held for seconds, so a leftover lock aged ~10 minutes must be taken over —
  # under the old code the lock reused the 2-hour SLOT threshold
  # (ISOLATE_STALE_THRESHOLD), so a crashed sweeper disabled stale reaping for
  # 2 hours. The takeover is an atomic mv-to-tombstone (only one of two racing
  # observers can win the rename), so no tombstone may leak either. The
  # companion guarantee — a FRESH lock is NOT taken over — is pinned by the
  # "fresh pre-existing .sweep.lock skips the sweep" test above.
  require_python3   # _touch_age computes the backdated stamp with python3
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "ghost-proj" > "$slots/0/project"   # dead project, no pid file
  mkdir -p "$slots/.sweep.lock"
  _touch_age 600 "$slots/.sweep.lock"      # >60s lock threshold, <<2h slot threshold

  export DOCKER_PS_OUTPUT=""
  _claim_isolate_slot
  # Takeover happened → the sweep ran → the dead slot 0 was reaped + reclaimed.
  [ "$ISOLATE_SLOT" = "0" ] \
    || fail "over-age sweep lock not taken over (sweep skipped); claimed: $ISOLATE_SLOT"
  [ ! -f "$slots/0/project" ] \
    || fail "ghost project record survived — sweep did not run after the takeover"
  # The winner's fresh lock was released on the way out, and no tombstone leaked.
  [ ! -d "$slots/.sweep.lock" ] || fail "sweep lock left behind after takeover sweep"
  run bash -c "ls -A '$slots' | grep -F '.sweep.lock.tomb'"
  [ "$status" -ne 0 ] || fail "takeover tombstone leaked: $output"
}

@test "sweep-lock release is own-lock-aware: a taken-over lock is left in place" {
  # Takeover/release race: if a slow sweeper's lock is taken over (heartbeat
  # stalled — e.g. a wedged docker daemon pushed it over-age), the ORIGINAL
  # holder's release must not remove the TAKEOVER's fresh lock — that would
  # open the door to a THIRD concurrent sweeper. Ownership is the pid file
  # written into the lock dir at acquisition; release only removes a lock
  # that still carries OUR pid. Tested via direct invocation of the release
  # helper (pausing a real sweep mid-flight is not deterministic in bats).
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  local lock="$slots/.sweep.lock"

  # Simulate the takeover: the lock exists but carries a DIFFERENT holder's
  # pid (the takeover rewrote it). PID 1 is never this test process.
  mkdir -p "$lock"
  echo "1" > "$lock/pid"
  run _release_sweep_lock "$lock"
  [ "$status" -eq 0 ] || fail "_release_sweep_lock failed on a foreign lock: $output"
  [ -d "$lock" ] || fail "release removed a lock owned by ANOTHER holder (takeover's lock destroyed)"
  [[ "$output" == *"taken over"* ]] || fail "no takeover warning printed: $output"

  # Control: a lock carrying OUR pid IS removed on release.
  echo "$$" > "$lock/pid"
  run _release_sweep_lock "$lock"
  [ "$status" -eq 0 ] || fail "_release_sweep_lock failed on our own lock: $output"
  [ ! -d "$lock" ] || fail "release left our own lock behind"
}

@test "an over-age takeover tombstone is reclaimed on the next claim; a fresh one survives" {
  # Crashed-takeover recovery: a sweeper that died between the takeover mv and
  # its rm -rf leaves .sweep.lock.tomb.<pid> behind — dot-named, invisible to
  # every glob, cleaned by nothing. The claim path must reclaim tombstones
  # older than the LOCK threshold, while leaving a FRESH tombstone alone (it
  # may belong to a takeover in flight: mv done, rm pending).
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/.sweep.lock.tomb.11111"
  touch -t 202001010000 "$slots/.sweep.lock.tomb.11111"   # far over the 60s lock threshold
  mkdir -p "$slots/.sweep.lock.tomb.22222"                # fresh — takeover may be in flight

  _claim_isolate_slot
  [ ! -d "$slots/.sweep.lock.tomb.11111" ] || fail "over-age tombstone leaked"
  [ -d "$slots/.sweep.lock.tomb.22222" ] || fail "fresh (possibly in-flight) tombstone was removed"
}

@test "sweep heartbeat never recreates a removed sweep lock (no plain-file resurrection)" {
  # Takeover/heartbeat race: the lock can be mv'd away (taken over) between
  # heartbeats. The OLD heartbeat (bare `touch "$sweep_lock"`) then RECREATED
  # the lock as a plain FILE — the takeover's `mkdir` failed against it and
  # sweeping wedged until the 60s over-age self-heal. The heartbeat must
  # refresh-only (touch -c behind a -d guard), never create. Direct
  # invocation: run the sweep with the lock already gone — exactly the
  # post-takeover view inside an iteration — and pin that no lock (file OR
  # dir) materializes.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"                      # one slot so the loop body (heartbeat) runs
  echo "ghost-proj" > "$slots/0/project"
  export DOCKER_PS_OUTPUT=""
  _sweep_isolate_slots
  [ ! -e "$slots/.sweep.lock" ] \
    || fail "heartbeat recreated the removed sweep lock: $(ls -ld "$slots/.sweep.lock")"
}

@test "an over-age PLAIN-FILE .sweep.lock (old heartbeat artifact) is taken over; claiming proceeds" {
  # Forward-compat with the old bug's residue: a pre-fix heartbeat could leave
  # the lock behind as a plain FILE. mkdir fails against it just like against
  # a dir, so it must flow through the same over-age takeover (mv works on
  # files too) instead of wedging the sweep/claim forever.
  require_python3   # _touch_age computes the backdated stamp with python3
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "ghost-proj" > "$slots/0/project"   # dead project, no pid file
  : > "$slots/.sweep.lock"                 # plain FILE, not a dir
  _touch_age 600 "$slots/.sweep.lock"      # over the 60s lock threshold
  export DOCKER_PS_OUTPUT=""
  _claim_isolate_slot
  # Takeover + sweep ran: the dead slot 0 was reaped and reclaimed.
  [ "$ISOLATE_SLOT" = "0" ] || fail "plain-file lock wedged the sweep; claimed: $ISOLATE_SLOT"
  # And nothing lock-shaped was left behind (takeover's own lock released).
  [ ! -e "$slots/.sweep.lock" ] || fail "stale plain-file lock (or its takeover) left behind"
  # No takeover tombstone leaked either (same guarantee the dir-lock variant
  # pins: the winner disposes of the mv'd-aside tombstone).
  run bash -c "ls -A '$slots' | grep -F '.sweep.lock.tomb'"
  [ "$status" -ne 0 ] || fail "takeover tombstone leaked: $output"
}

@test "claim survives an over-age tombstone whose removal fails (set -e safety)" {
  # The tombstone reclamation runs OUTSIDE the sweep lock by design, so two
  # claimants can race the same rm: both observe the tombstone over-age, one
  # wins, and the loser's mid-traversal ENOENT makes its rm exit nonzero —
  # under bin/showcase's `set -euo pipefail` that used to kill the whole CLI.
  # The race itself isn't deterministically reproducible in bats; an
  # unremovable tombstone (non-writable dir with contents) forces the same
  # nonzero rm exit deterministically.
  #
  # Root caveat: as root, `chmod a-w` does not block rm — the tombstone is
  # removed anyway, the failure can't be forced, and the cleanup chmod below
  # would then ERROR on the vanished path under bats errexit. Skip as root.
  [ "$(id -u)" -ne 0 ] || skip "rm -rf succeeds as root — cannot force the tombstone rm failure"
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/.sweep.lock.tomb.99999/inner"
  touch -t 202001010000 "$slots/.sweep.lock.tomb.99999"   # far over the 60s threshold
  chmod a-w "$slots/.sweep.lock.tomb.99999"               # rm -rf cannot unlink 'inner'
  run bash -euo pipefail -c "source '$COMMON'; _claim_isolate_slot; echo \"CLAIMED=\$ISOLATE_SLOT\""
  # Let bats teardown clean up; guarded — the tombstone may be gone if rm
  # unexpectedly succeeded, and a chmod error here must not mask the real
  # assertions below.
  chmod u+w "$slots/.sweep.lock.tomb.99999" 2>/dev/null || true
  [ "$status" -eq 0 ] || fail "claim died under set -e on a failed tombstone rm: $output"
  [[ "$output" == *"CLAIMED=0"* ]] \
    || fail "claim did not proceed past the failed tombstone rm: $output"
}

@test "takeover survives a failed tombstone disposal (set -e safety) and still sweeps" {
  # The takeover winner's `rm -rf $lock_tombstone` is ACTIVELY raced: mv
  # preserves the (already over-age) lock mtime, so the fresh tombstone is
  # immediately over-age and concurrent claimants' tombstone-reclamation
  # loops legitimately race its removal — the loser's nonzero rm must not
  # kill the CLI under bin/showcase's `set -euo pipefail`. As in the
  # tombstone-reclamation test above, the race itself isn't deterministic in
  # bats; an unremovable tombstone (non-writable dir with contents, preserved
  # verbatim by the takeover mv) forces the same nonzero rm exit.
  require_python3   # _touch_age computes the backdated stamp with python3
  [ "$(id -u)" -ne 0 ] || skip "rm -rf succeeds as root — cannot force the tombstone rm failure"
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "ghost-proj" > "$slots/0/project"   # dead project, no pid file
  mkdir -p "$slots/.sweep.lock/inner"      # over-age lock the takeover will mv aside
  _touch_age 600 "$slots/.sweep.lock"      # >60s lock threshold
  chmod a-w "$slots/.sweep.lock"           # rm -rf of the mv'd tombstone cannot unlink 'inner'
  export DOCKER_PS_OUTPUT=""
  run bash -euo pipefail -c "source '$COMMON'; _claim_isolate_slot; echo \"CLAIMED=\$ISOLATE_SLOT\""
  # Let bats teardown clean up the unremovable tombstone (pid-suffixed by the
  # child, hence the glob); guarded — must not mask the assertions below.
  chmod u+w "$slots"/.sweep.lock.tomb.* 2>/dev/null || true
  [ "$status" -eq 0 ] || fail "takeover died under set -e on a failed tombstone rm: $output"
  # The takeover completed despite the failed disposal: fresh lock acquired,
  # sweep ran, dead slot 0 reaped + reclaimed.
  [[ "$output" == *"CLAIMED=0"* ]] \
    || fail "sweep did not run after the failed tombstone disposal: $output"
}

@test "_release_sweep_lock distinguishes a vanished lock from a takeover" {
  # When the lock (or its pid ownership marker) is GONE entirely, the release
  # used to mis-report "taken over (current holder pid: unknown)" — there is
  # no holder to report. A vanished lock gets its own message; the takeover
  # warn (pinned by the own-lock-aware test above) stays reserved for a lock
  # that actually carries a DIFFERENT holder's pid.
  load_common
  local lock="$XDG_STATE_HOME/copilotkit/showcase/slots/.sweep.lock"
  [ ! -e "$lock" ] || fail "precondition: lock unexpectedly exists"
  run _release_sweep_lock "$lock"
  [ "$status" -eq 0 ] || fail "_release_sweep_lock failed on a missing lock: $output"
  [[ "$output" == *"vanished"* ]] || fail "missing lock not reported as vanished: $output"
  [[ "$output" != *"taken over"* ]] || fail "missing lock mis-reported as a takeover: $output"
}

# ── Change 3: restore_isolation honors --keep ────────────────────────────────

@test "restore_isolation with keep set preserves slot + run dir and prints survival notice" {
  require_python3
  load_common
  apply_isolation keepme
  local slotdir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  local rundir="$ISOLATE_TMPDIR"
  [ -d "$slotdir" ] || fail "precondition: slot dir missing after apply"
  [ -d "$rundir" ]  || fail "precondition: run dir missing after apply"

  # Truncate the stub log: apply_isolation's idempotent pre-down already
  # logged a `--project-name keepme down ...` line, which would poison the
  # does-NOT-compose-down assertion below. The `docker version` sentinel then
  # proves the stub→DOCKER_LOG pipeline is still live AFTER the truncation,
  # so the absence check cannot pass vacuously.
  : > "$DOCKER_LOG"
  docker version

  ISOLATE_KEEP=true
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation failed under keep: $output"

  # Nothing torn down: slot + run dir survive, slot NOT released.
  [ -d "$slotdir" ] || fail "kept slot dir was removed"
  [ -d "$rundir" ]  || fail "kept run dir was removed"

  # Survival notice content: project name, the 3 +offset host ports, teardown cmd.
  # Explicit name 'keepme' on slot 0 -> offset 200: aimock 4210, dashboard 3400,
  # pocketbase 8290.
  [[ "$output" == *"keepme"* ]] || fail "notice missing project name: $output"
  [[ "$output" == *"4210"* ]] || fail "notice missing aimock host port: $output"
  [[ "$output" == *"3400"* ]] || fail "notice missing dashboard host port: $output"
  [[ "$output" == *"8290"* ]] || fail "notice missing pocketbase host port: $output"
  [[ "$output" == *"docker compose -p keepme down"* ]] \
    || fail "notice missing literal teardown command: $output"

  # The keep path's central promise: it does NOT compose-down the kept stack.
  # (Last, because `run grep` clobbers the $output the notice checks read.)
  _assert_stub_sentinel_logged
  run grep -E -- "--project-name keepme down" "$DOCKER_LOG"
  [ "$status" -ne 0 ] || fail "keep path composed the kept stack down: $output"
}

# ── Change 4: a FAILED apply_isolation must never down the default stack ─────
#
# cmd-test.sh registers `trap restore_isolation EXIT` BEFORE calling
# apply_isolation, so a die() inside apply_isolation (invalid name, slot
# exhaustion, ...) fires the trap with half-initialized isolation state. If
# ISOLATE_ACTIVE was already true while COMPOSE_CMD still pointed at the
# ORIGINAL docker-compose.local.yml (no project name), restore_isolation would
# silently `compose down` the user's live DEFAULT stack. This pins that a
# failed apply_isolation results in NO compose-down against the default project.

@test "failed apply_isolation (invalid name) does not compose-down the default stack via the EXIT trap" {
  load_common
  # Mirror cmd-test.sh's real registration order in a child bash process run
  # under bin/showcase's real shell options (-euo pipefail): a sentinel docker
  # call proves the stub+log pipeline, the EXIT trap is armed, then
  # apply_isolation dies on the invalid name ('MyName!' lowercases to
  # 'myname!', which still fails [a-z0-9][a-z0-9_-]*).
  run bash -euo pipefail -c "
    source '$COMMON'
    SHOWCASE_ROOT='$SHOWCASE_ROOT_OVERRIDE'
    COMPOSE_FILE=\"\$SHOWCASE_ROOT/docker-compose.local.yml\"
    PORTS_FILE=\"\$SHOWCASE_ROOT/shared/local-ports.json\"
    COMPOSE_CMD=\"docker compose -f \$COMPOSE_FILE\"
    docker version   # sentinel: prove stub+DOCKER_LOG wiring BEFORE the trap
    trap restore_isolation EXIT
    apply_isolation 'MyName!'
  "
  [ "$status" -ne 0 ] || fail "apply_isolation unexpectedly succeeded with invalid name 'MyName!'"

  # Stub pipeline verified live — now absence of compose-down is meaningful.
  _assert_stub_sentinel_logged

  # The EXIT trap must NOT have run any `compose ... down` (word-matched, so a
  # project name merely CONTAINING "down" can't satisfy/poison the check, and
  # the bare minimal `compose down` — no args in between — is matched too) —
  # neither against the original compose file nor the (never-created)
  # isolated project.
  local default_compose="$SHOWCASE_ROOT_OVERRIDE/docker-compose.local.yml"
  run grep -E "(^|[[:space:]])compose([[:space:]].*)?[[:space:]]down([[:space:]]|\$)" "$DOCKER_LOG"
  [ "$status" -ne 0 ] \
    || fail "EXIT trap composed down after failed apply_isolation: $output"
  run grep -F "$default_compose" "$DOCKER_LOG"
  [ "$status" -ne 0 ] \
    || fail "EXIT trap touched the default compose file after failed apply_isolation: $output"
}

@test "apply_isolation dying AFTER the slot claim (python3 failure) does not compose-down the default stack via the EXIT trap" {
  load_common
  # The dangerous window is wider than the pre-claim die above: apply_isolation
  # can also die AFTER the slot claim but BEFORE ISOLATE_ACTIVE=true — e.g. the
  # python3 ports/compose rewriters failing. COMPOSE_CMD still points at the
  # ORIGINAL compose file in that window, so the armed EXIT trap must not run
  # any compose-down against the default stack. Poison python3 via a PATH stub
  # in the child to force the post-claim die.
  #
  # NB: this test pins ONLY the no-default-stack-compose-down invariant; what
  # happens to the slot/run dirs in this window is pinned elsewhere.
  local pybad="$BATS_TEST_TMPDIR/pybad"
  mkdir -p "$pybad"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$pybad/python3"
  chmod +x "$pybad/python3"

  run bash -euo pipefail -c "
    PATH='$pybad':\"\$PATH\"   # poison python3; docker stub stays on PATH
    source '$COMMON'
    SHOWCASE_ROOT='$SHOWCASE_ROOT_OVERRIDE'
    COMPOSE_FILE=\"\$SHOWCASE_ROOT/docker-compose.local.yml\"
    PORTS_FILE=\"\$SHOWCASE_ROOT/shared/local-ports.json\"
    COMPOSE_CMD=\"docker compose -f \$COMPOSE_FILE\"
    docker version   # sentinel: prove stub+DOCKER_LOG wiring BEFORE the trap
    trap restore_isolation EXIT
    apply_isolation 'pyfail'
  "
  [ "$status" -ne 0 ] || fail "apply_isolation unexpectedly succeeded with a poisoned python3"

  # Stub pipeline verified live — now absence of compose-down is meaningful.
  _assert_stub_sentinel_logged

  # No compose-down of ANY kind may have run in this window: the idempotent
  # pre-down comes only after ISOLATE_ACTIVE=true (never reached here), and
  # the trap's half-init cleanup is state-only. The pattern also matches the
  # bare minimal `compose down` (no args between the two words), which a
  # `compose .*[[:space:]]down` regex would miss.
  run grep -E "(^|[[:space:]])compose([[:space:]].*)?[[:space:]]down([[:space:]]|\$)" "$DOCKER_LOG"
  [ "$status" -ne 0 ] \
    || fail "EXIT trap composed down after post-claim die: $output"
}

# ── Leading-character rule: compose project names must START with [a-z0-9] ───
#
# docker compose accepts [a-z0-9][a-z0-9_-]* — '_' and '-' are valid only in
# the INTERIOR of a project name. Names like '_foo' or '-foo' used to slip
# through the CLI check (which only looked for chars outside [a-z0-9_-]) and
# then failed deep inside compose with exactly the opaque error this
# validation exists to prevent.

@test "apply_isolation rejects names with an invalid leading character" {
  load_common
  run apply_isolation '_foo'
  [ "$status" -ne 0 ] || fail "apply_isolation unexpectedly accepted '_foo'"
  [[ "$output" == *"must start with a lowercase letter or digit"* ]] \
    || fail "die message does not describe the leading-character rule: $output"

  run apply_isolation '-foo'
  [ "$status" -ne 0 ] || fail "apply_isolation unexpectedly accepted '-foo'"
  [[ "$output" == *"must start with a lowercase letter or digit"* ]] \
    || fail "die message does not describe the leading-character rule: $output"
}

@test "apply_isolation accepts a normal name with interior '_' and '-'" {
  require_python3
  load_common
  apply_isolation 'foo_bar-9'
  [[ "$ISOLATE_TMPDIR" == "$XDG_STATE_HOME/copilotkit/showcase/runs/foo_bar-9" ]] \
    || fail "valid name 'foo_bar-9' was not accepted: $ISOLATE_TMPDIR"
}

# ── Reserved name: 'showcase' IS the default stack's compose project ─────────
#
# docker compose defaults the project name to the directory name, so the
# DEFAULT stack's project is literally "showcase". An accidental
# `--isolate showcase` used to sail through the charset validation (the
# container-name rewrite showcase- → showcase- is a no-op), and the idempotent
# pre-down then ran `--project-name showcase down --remove-orphans --volumes`
# — tearing down the user's live default stack, bypassing every guard this
# code has.

@test "apply_isolation rejects the reserved name 'showcase' before any compose command" {
  load_common
  docker version   # sentinel: prove stub+DOCKER_LOG wiring BEFORE the call
  run apply_isolation showcase
  [ "$status" -ne 0 ] || fail "apply_isolation accepted the reserved name 'showcase'"
  [[ "$output" == *"reserved"* ]] \
    || fail "die message does not say the name is reserved: $output"

  # The uppercase variant must be caught too: the check runs AFTER the
  # lowercase normalization, so 'Showcase' lowercases into the reserved name.
  run apply_isolation Showcase
  [ "$status" -ne 0 ] || fail "apply_isolation accepted 'Showcase' (lowercases to the reserved name)"
  [[ "$output" == *"reserved"* ]] \
    || fail "die message for 'Showcase' does not say the name is reserved: $output"

  # No compose command of ANY kind may have run — the rejection must land
  # BEFORE the idempotent pre-down that would hit the default stack. Word-
  # matched so the sweep's `ps -q --filter label=com.docker.compose.project=…`
  # line can't satisfy/poison the check. The sentinel proves the stub→log
  # pipeline is live first, so this absence check cannot pass vacuously.
  _assert_stub_sentinel_logged
  run grep -E "(^|[[:space:]])compose([[:space:]]|\$)" "$DOCKER_LOG"
  [ "$status" -ne 0 ] \
    || fail "reserved-name rejection ran a compose command: $output"
}

@test "restore_isolation without keep removes run dir and releases slot" {
  require_python3
  load_common
  apply_isolation dropme
  local slotdir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  local rundir="$ISOLATE_TMPDIR"
  [ -d "$slotdir" ] || fail "precondition: slot dir missing after apply"
  [ -d "$rundir" ]  || fail "precondition: run dir missing after apply"

  # Truncate the stub log NOW: apply_isolation's idempotent pre-down logs a
  # BYTE-IDENTICAL `--project-name dropme down --remove-orphans --volumes`
  # line, so without the truncation the teardown assertion below would pass
  # vacuously even if restore_isolation dropped --volumes or never composed
  # down at all. After the truncation, any matching line can only have come
  # from the teardown itself.
  : > "$DOCKER_LOG"

  ISOLATE_KEEP=false
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation failed: $output"

  # NB `run` executes in a subshell, so the parent's ISOLATE_* are unchanged; we
  # assert on the filesystem effects, which DO persist across the subshell.
  [ ! -d "$rundir" ] || fail "run dir not removed on teardown: $rundir"
  [ ! -d "$slotdir" ] || fail "slot not released on teardown: $slotdir"

  # Volumes consistency: isolated stacks are ephemeral, and both printed
  # manual teardown commands (keep notice + failed-down recovery) include
  # --volumes. The AUTOMATIC teardown must agree, or project-scoped named
  # volumes leak (unbounded for explicit names). The log was truncated after
  # apply_isolation returned (see above), so this match is necessarily the
  # teardown's own project-named down carrying --volumes.
  run grep -E -- "--project-name dropme down --remove-orphans --volumes" "$DOCKER_LOG"
  [ "$status" -eq 0 ] \
    || fail "automatic teardown down did not include --volumes: $(cat "$DOCKER_LOG")"
}

# ── Duplicate explicit --isolate name must not destroy a live run ────────────
#
# apply_isolation's idempotent pre-down keys on the compose project NAME, but
# the slot registry only enforces SLOT uniqueness. A second concurrent run
# passing the same explicit --isolate <name> used to get a different slot but
# the same compose project — its pre-down silently tore down the first run's
# containers mid-test (or a --keep-parked stack), and two slots then recorded
# the same project name, corrupting the liveness-reaping signal.

@test "apply_isolation dies on a duplicate explicit name without composing it down" {
  load_common
  # Seed slot 0 as another LIVE run already using "dupename": project recorded,
  # owning PID alive (this bats process), so the stale-sweep must not reap it.
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "dupename" > "$slots/0/project"
  echo "$$" > "$slots/0/pid"

  export DOCKER_PS_OUTPUT=""   # zero containers (still building) — PID protects
  run apply_isolation dupename
  [ "$status" -ne 0 ] || fail "apply_isolation accepted a duplicate name"
  [[ "$output" == *"already in use by slot 0"* ]] \
    || fail "die message does not name the conflicting slot: $output"

  # The live run's stack must be untouched: NO compose-down of any kind may
  # have run (the pre-down comes only after the duplicate guard). The sweep is
  # expected to have called `docker ps` for the recorded project — assert that
  # exact invocation actually landed in the log (the stub logs one
  # "$*"-joined line per call), not merely that the log file exists: a
  # silently broken stub/DOCKER_LOG pipeline would make the absence check
  # below pass vacuously.
  [ -f "$DOCKER_LOG" ] \
    || fail "docker stub log missing — the sweep should have called docker ps; absence check would be vacuous"
  grep -qxF -- "ps -q --filter label=com.docker.compose.project=dupename" "$DOCKER_LOG" \
    || fail "sweep's docker ps invocation not logged — stub/DOCKER_LOG pipeline broken, absence check would be vacuous: $(cat "$DOCKER_LOG")"
  run grep -E "(^|[[:space:]])compose([[:space:]].*)?[[:space:]]down([[:space:]]|\$)" "$DOCKER_LOG"
  [ "$status" -ne 0 ] \
    || fail "duplicate-name run composed down the live project: $output"

  # Slot 0's record survives intact for the live owner.
  [ -d "$slots/0" ] || fail "live slot 0 was reaped during the duplicate claim"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "live slot 0 project file missing after duplicate claim"
  [[ "$output" == "dupename" ]] || fail "live slot 0 project mangled: $output"
}

@test "duplicate-name guard is claim-then-verify: loser backs off without touching the winner" {
  # TOCTOU regression: the guard used to SCAN the other slots and only then
  # write its own project record. Two concurrent same-name claims could both
  # pass the scan and both record the name — one run's pre-down then tore the
  # other's stack down mid-test, and reaping either slot deleted the SHARED
  # runs/<name> dir. The fix writes our record FIRST, then scans: the later
  # writer of any concurrent pair is guaranteed to see the earlier record and
  # back off (die) before runs/<name> is ever created or touched.
  load_common
  local base="$XDG_STATE_HOME/copilotkit/showcase"
  local slots="$base/slots"
  # Winner: slot 0 already holds 'dup' (live owning PID) plus its run dir.
  mkdir -p "$slots/0"
  echo "dup" > "$slots/0/project"
  echo "$$" > "$slots/0/pid"
  mkdir -p "$base/runs/dup"
  touch "$base/runs/dup/docker-compose.local.yml"
  export DOCKER_PS_OUTPUT=""   # zero containers (still building) — PID protects

  # Ordering pin (claim BEFORE verify): `run` dies in a subshell with no trap,
  # so the loser's slot dir survives for inspection — and it must already
  # contain our own 'dup' record, written BEFORE the conflict scan. Under the
  # old scan-then-write order this record never exists (that unrecorded window
  # is exactly the TOCTOU hole).
  run apply_isolation dup
  [ "$status" -ne 0 ] || fail "apply_isolation accepted duplicate name 'dup'"
  [[ "$output" == *"already in use by slot 0"* ]] \
    || fail "die message does not name the conflicting slot: $output"
  run cat "$slots/1/project"
  [ "$status" -eq 0 ] \
    || fail "loser did not record its claim BEFORE verifying (scan-then-write TOCTOU order)"
  [[ "$output" == "dup" ]] || fail "loser recorded the wrong project: $output"
  rm -rf "$slots/1"   # clear the no-trap leftovers; trap cleanup is pinned next

  # Real wiring (trap armed first, bin/showcase's shell options): the loser's
  # die must clean up its OWN slot — including the just-written record — via
  # the EXIT trap, and the winner's slot record AND runs/dup dir must be
  # untouched (ISOLATE_TMPDIR is set only after the verify passes, so the
  # loser's cleanup cannot reach the shared run dir).
  run bash -euo pipefail -c "
    source '$COMMON'
    SHOWCASE_ROOT='$SHOWCASE_ROOT_OVERRIDE'
    COMPOSE_FILE=\"\$SHOWCASE_ROOT/docker-compose.local.yml\"
    PORTS_FILE=\"\$SHOWCASE_ROOT/shared/local-ports.json\"
    COMPOSE_CMD=\"docker compose -f \$COMPOSE_FILE\"
    trap restore_isolation EXIT
    apply_isolation dup
  "
  [ "$status" -ne 0 ] || fail "apply_isolation accepted duplicate name 'dup' (trap run)"
  [ ! -d "$slots/1" ] || fail "loser's slot/record leaked after the EXIT trap: $slots/1"
  # Winner untouched: record intact, run dir (and its contents) intact.
  [ -d "$slots/0" ] || fail "winner's slot was reaped by the losing claim"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "winner's project record missing"
  [[ "$output" == "dup" ]] || fail "winner's project record mangled: $output"
  [ -f "$base/runs/dup/docker-compose.local.yml" ] \
    || fail "winner's run dir was damaged by the losing claim"
}

@test "duplicate-name guard treats an EQUAL-mtime conflicting record as a conflict (tie = back off)" {
  # Tie semantics pin: the backoff comparison is `-le` — a conflicting record
  # that does NOT strictly postdate ours (older OR EQUAL epoch mtime) means we
  # lose. A regression to `-lt` would make two same-second claimants BOTH
  # treat the other's record as "strictly newer → the other backs off" and
  # BOTH proceed as dual owners of one compose project. The other duplicate
  # tests seed their conflicting record by wall clock, so whether they hit
  # the equal or the older branch depends on second-boundary timing; force
  # the tie DETERMINISTICALLY by stubbing _file_mtime to one fixed epoch for
  # every path (safe here: slot 0 is pid-protected, so the sweep never
  # consults mtimes, and no tombstones/locks exist).
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "tiename" > "$slots/0/project"
  echo "$$" > "$slots/0/pid"           # live owner — sweep must not reap it
  export DOCKER_PS_OUTPUT=""

  _file_mtime() { echo 1700000000; }   # our record and theirs: EQUAL mtimes

  run apply_isolation tiename
  [ "$status" -ne 0 ] \
    || fail "equal-mtime conflicting record did not back the claimant off (tie regression: -le became -lt?)"
  [[ "$output" == *"already in use by slot 0"* ]] \
    || fail "die message does not name the conflicting slot: $output"
}

@test "re-using a name after clean teardown still works" {
  require_python3
  load_common
  apply_isolation reusable
  ISOLATE_KEEP=false
  restore_isolation
  # The old slot was released and its record removed — the name is free again.
  # (In production restore_isolation only runs at EXIT; it does not repoint
  # COMPOSE_FILE/PORTS_FILE/COMPOSE_CMD at the originals. Re-point them here
  # the way a fresh process sourcing _common.sh would see them.)
  COMPOSE_FILE="$SHOWCASE_ROOT/docker-compose.local.yml"
  PORTS_FILE="$SHOWCASE_ROOT/shared/local-ports.json"
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE"
  apply_isolation reusable
  [[ "$ISOLATE_NAME" == "reusable" ]] || fail "name not reusable after teardown"
}

# ── Half-initialized apply_isolation must clean its state via the EXIT trap ──
#
# If apply_isolation dies AFTER _claim_isolate_slot but BEFORE
# ISOLATE_ACTIVE=true (python3 failure, mkdir failure), the EXIT trap's
# restore_isolation must not compose-down anything (that guard protects the
# user's default stack) — but it used to ALSO leak the claimed slot dir and
# the runs/<name> dir silently. The slot self-healed via the stale-sweep; the
# runs dir never did. Pin that the trap now cleans both, with NO compose
# command at all.

@test "half-initialized apply_isolation cleans slot and run dir via EXIT trap without any compose" {
  # Poison python3 so apply_isolation dies after the slot claim, project-file
  # write, and run-dir mkdir — i.e. genuinely half-initialized.
  local poison="$BATS_TEST_TMPDIR/poison"
  mkdir -p "$poison"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$poison/python3"
  chmod +x "$poison/python3"

  # Mirror cmd-test.sh's real wiring in a child bash: trap armed first, then
  # apply_isolation fails partway through under set -euo pipefail.
  run bash -euo pipefail -c "
    PATH='$poison':\"\$PATH\"
    source '$COMMON'
    SHOWCASE_ROOT='$SHOWCASE_ROOT_OVERRIDE'
    COMPOSE_FILE=\"\$SHOWCASE_ROOT/docker-compose.local.yml\"
    PORTS_FILE=\"\$SHOWCASE_ROOT/shared/local-ports.json\"
    COMPOSE_CMD=\"docker compose -f \$COMPOSE_FILE\"
    docker version   # sentinel: prove stub+DOCKER_LOG wiring BEFORE the trap
    trap restore_isolation EXIT
    apply_isolation halfinit
  "
  [ "$status" -ne 0 ] || fail "apply_isolation unexpectedly survived poisoned python3"

  # State cleaned: the claimed slot AND the runs/<name> dir are gone.
  [ ! -d "$XDG_STATE_HOME/copilotkit/showcase/slots/0" ] \
    || fail "half-initialized slot dir leaked"
  [ ! -d "$XDG_STATE_HOME/copilotkit/showcase/runs/halfinit" ] \
    || fail "half-initialized run dir leaked"

  # And the cleanup was STATE-ONLY: no compose command of any kind ran (the
  # compose-down hazard against the default stack is exactly what the
  # ISOLATE_ACTIVE guard prevents — cleanup must not reintroduce it). The
  # sentinel proves the stub→log pipeline is live first, so this absence
  # check cannot pass vacuously. Word-matched so the sweep's
  # `ps -q --filter label=com.docker.compose.project=…` line can't
  # satisfy/poison the check.
  _assert_stub_sentinel_logged
  run grep -E "(^|[[:space:]])compose([[:space:]]|\$)" "$DOCKER_LOG"
  [ "$status" -ne 0 ] \
    || fail "half-init cleanup ran a compose command: $output"
}

@test "restore_isolation without keep preserves run dir and slot when compose down FAILS" {
  require_python3
  # Split-brain regression: a silently failed `compose down` (stderr to
  # /dev/null, `|| true`) used to leave the stack RUNNING while the run dir
  # (the only copy of the rewritten compose file) and the slot were deleted —
  # live containers with no state and a re-claimable slot (port collisions).
  # On compose-down failure the evidence must survive and a loud warning with
  # the project name + manual teardown command must print.
  load_common
  apply_isolation downfail
  local slotdir="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT"
  local rundir="$ISOLATE_TMPDIR"
  [ -d "$slotdir" ] || fail "precondition: slot dir missing after apply"
  [ -d "$rundir" ]  || fail "precondition: run dir missing after apply"

  # Set AFTER apply_isolation so its idempotent pre-down is unaffected.
  export DOCKER_COMPOSE_DOWN_EXIT=1
  ISOLATE_KEEP=false
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation must not propagate the failure: $output"

  # Evidence preserved: run dir kept, slot NOT released.
  [ -d "$rundir" ]  || fail "run dir deleted despite failed compose down"
  [ -d "$slotdir" ] || fail "slot released despite failed compose down"

  # Loud warning: project name + manual teardown command for recovery.
  [[ "$output" == *"downfail"* ]] || fail "warning missing project name: $output"
  [[ "$output" == *"docker compose -p downfail down"* ]] \
    || fail "warning missing manual teardown command: $output"
}

@test "restore_isolation guard mismatch warns and preserves run dir + slot (no fall-through deletion)" {
  # Belt-and-suspenders divergence: ISOLATE_ACTIVE=true but COMPOSE_CMD is NOT
  # repointed at the isolated project. The old code skipped the compose-down
  # (correct — never down an unknown target) but then FELL THROUGH to deleting
  # the run dir and releasing the slot, manufacturing the exact split-brain
  # the adjacent comment documents: a possibly-running stack whose only
  # compose state is deleted and whose slot is reclaimable. Unreachable
  # through today's call paths (apply_isolation sets ISOLATE_ACTIVE only
  # after the repoint), but the defensive path must be SAFE, not destructive:
  # warn loudly and preserve everything, mirroring the failed-down branch.
  load_common
  local base="$XDG_STATE_HOME/copilotkit/showcase"
  mkdir -p "$base/slots/3" "$base/runs/mismatched"
  echo "$$" > "$base/slots/3/pid"
  ISOLATE_ACTIVE=true
  ISOLATE_NAME="mismatched"
  ISOLATE_SLOT=3
  ISOLATE_TMPDIR="$base/runs/mismatched"
  ISOLATE_KEEP=false
  # COMPOSE_CMD (from load_common) carries NO --project-name — the mismatch.
  : > "$DOCKER_LOG"
  docker version
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation failed on the mismatch path: $output"
  [ -d "$base/runs/mismatched" ] \
    || fail "run dir deleted on the guard-mismatch path (split-brain)"
  [ -d "$base/slots/3" ] \
    || fail "slot released on the guard-mismatch path (split-brain)"
  [[ "$output" == *"mismatch"* ]] \
    || fail "no loud warning on the guard-mismatch path: $output"
  [[ "$output" == *"docker compose -p mismatched down"* ]] \
    || fail "warning missing manual teardown command: $output"
  # No compose command of any kind ran — COMPOSE_CMD's target is unknown.
  _assert_stub_sentinel_logged
  run grep -E "(^|[[:space:]])compose([[:space:]].*)?[[:space:]]down([[:space:]]|\$)" "$DOCKER_LOG"
  [ "$status" -ne 0 ] || fail "guard-mismatch path ran a compose down: $output"
}

@test "apply_isolation warns (but does not die) when the idempotent pre-down fails" {
  require_python3
  # The pre-down exists to clear a prior crashed run's containers/volumes. Its
  # failure must stay non-fatal (the common case is "nothing to tear down"),
  # but it must not be SILENT either — leftover state is exactly what the
  # pre-clean is for, so the user gets a warning that it may remain.
  load_common
  export DOCKER_COMPOSE_DOWN_EXIT=1   # set BEFORE apply: poison the pre-down
  run apply_isolation predownfail
  [ "$status" -eq 0 ] || fail "apply_isolation died on a failed pre-down: $output"
  [[ "$output" == *"pre-clean of project predownfail failed"* ]] \
    || fail "no warning printed for the failed pre-down: $output"
  [[ "$output" == *"Isolation active"* ]] \
    || fail "apply_isolation did not complete after the failed pre-down: $output"
}

@test "EXIT trap honors keep flag set inside a function that has returned (real cmd_test wiring)" {
  require_python3
  # Regression test for the --keep teardown bug: cmd_test used to hold the keep
  # flag in a `local keep`. On the NORMAL path cmd_test returns, its locals
  # unwind, and the EXIT trap fires later at top-level script exit — where the
  # local no longer exists — so restore_isolation read `${keep:-false}` as
  # false and tore the kept stack down anyway. (The earlier tests above call
  # restore_isolation directly with the flag set at test scope, which is
  # exactly the pattern that masked this.)
  #
  # This test exercises the REAL wiring: a child bash sources _common.sh,
  # registers `trap restore_isolation EXIT`, then a function sets the keep flag
  # the same way cmd_test's --keep handler does, applies isolation, RETURNS,
  # and the script exits normally. The run dir and slot must survive the trap
  # and the survival notice must print.
  cat > "$BATS_TEST_TMPDIR/keep-wiring.sh" <<'FIXTURE'
#!/usr/bin/env bash
set -euo pipefail   # bin/showcase's real shell options — fixture fidelity
# shellcheck disable=SC1090
source "$COMMON_SH"
# Repoint the derived paths at the per-test fake root (same as load_common).
SHOWCASE_ROOT="$SHOWCASE_ROOT_OVERRIDE"
COMPOSE_FILE="$SHOWCASE_ROOT/docker-compose.local.yml"
PORTS_FILE="$SHOWCASE_ROOT/shared/local-ports.json"
COMPOSE_CMD="docker compose -f $COMPOSE_FILE"

fake_cmd_test() {
  ISOLATE_KEEP=true   # what cmd_test's --keep arg handler does
  trap restore_isolation EXIT
  apply_isolation trapkeep
  return 0
}
fake_cmd_test
# Truncate the stub log: apply_isolation's idempotent pre-down already logged
# a `--project-name trapkeep down ...` line that would poison the parent
# test's does-NOT-compose-down assertion. The `docker version` sentinel then
# proves the stub→DOCKER_LOG pipeline is still live after the truncation.
: > "$DOCKER_LOG"
docker version
exit 0   # locals (if any) are long gone; the EXIT trap fires HERE
FIXTURE

  export COMMON_SH="$COMMON"
  run bash "$BATS_TEST_TMPDIR/keep-wiring.sh"
  [ "$status" -eq 0 ] || fail "fixture script failed: $output"

  # Survival: the run dir and slot must still exist after the trap ran.
  local slotdir="$XDG_STATE_HOME/copilotkit/showcase/slots/0"
  local rundir="$XDG_STATE_HOME/copilotkit/showcase/runs/trapkeep"
  [ -d "$rundir" ]  || fail "kept run dir was torn down by the EXIT trap: $output"
  [ -d "$slotdir" ] || fail "kept slot was released by the EXIT trap: $output"
  [[ "$output" == *"Kept isolated group standing"* ]] \
    || fail "survival notice not printed at exit: $output"

  # The keep path's central promise, under the REAL trap wiring: the EXIT trap
  # did NOT compose-down the kept stack. The log was truncated inside the
  # fixture after apply_isolation's pre-down, and the sentinel proves the
  # stub→log pipeline stayed live, so this absence check is not vacuous.
  _assert_stub_sentinel_logged
  run grep -E -- "--project-name trapkeep down" "$DOCKER_LOG"
  [ "$status" -ne 0 ] || fail "EXIT trap composed the kept stack down: $output"
}
