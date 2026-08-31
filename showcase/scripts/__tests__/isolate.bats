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

# _seed_live_owner <slot-dir> [pid] — record a LIVE, start-time-VERIFIED owner
# in <slot-dir>: write the pid file AND a matching pid.start (the new
# anti-PID-reuse fingerprint). Under the post-Change-1 owner contract a bare
# `pid` file with NO pid.start is "unverifiable" (treated as dead), so every
# fixture that wants a slot to read `live` via its owning PID must seed BOTH
# files — that is what this helper does. Defaults to $$ (the bats process,
# definitely alive). The pid.start is produced by the SAME _pid_start_time
# helper the classifier reads, so the recorded and current values match. The
# pid file is written FIRST (preserving the claim-time write order the
# classifier's "missing pid ⇒ owner gone" signal relies on).
#
# NB: this sources _common.sh into the CURRENT shell to reach _pid_start_time.
# Tests that have already run load_common are unaffected; tests that have not
# get a harmless extra source (the path vars are re-pointed by load_common).
_seed_live_owner() {
  local slotdir="${1:?slot dir required}"
  local pid="${2:-$$}"
  # shellcheck disable=SC1090
  type _pid_start_time >/dev/null 2>&1 || source "$COMMON"
  echo "$pid" > "$slotdir/pid"
  _pid_start_time "$pid" > "$slotdir/pid.start"
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

  # ── Fake lsof on PATH ──────────────────────────────────────────────────────
  # apply_isolation's port-conflict probe (and cmd-doctor.sh) shell out to
  # `lsof -i :<port> -sTCP:LISTEN -P -n`. Real lsof on the dev box reports
  # whatever happens to be listening, which is both non-deterministic and
  # non-hermetic. The stub drives held-port reporting from $LSOF_HOLD_PORTS
  # (comma-separated): ports in the list emit the standard lsof header + a
  # single LISTEN row and exit 0; ports not in the list exit 1 with empty
  # stdout, mirroring real lsof's no-match semantics. Every invocation is
  # appended to $LSOF_LOG so tests can assert which ports got probed.
  cat > "$STUB_DIR/lsof" <<'STUB'
#!/usr/bin/env bash
# Record every invocation so tests can assert WHICH ports were probed.
echo "lsof $*" >> "${LSOF_LOG:-/dev/null}"
# Extract the port from `-i :<port>`. cmd-doctor.sh and _common.sh both invoke
# `lsof -i :<port> -sTCP:LISTEN -P -n`, so the port arg is the one following
# `-i`, with a leading colon. Other args (-sTCP:LISTEN, -P, -n) are tolerated
# and ignored — the stub does not care about protocol/numeric flags.
port=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-i" ] && [[ "${2:-}" =~ ^:([0-9]+)$ ]]; then
    port="${BASH_REMATCH[1]}"
    break
  fi
  shift
done
[ -n "$port" ] || exit 1
# Check $LSOF_HOLD_PORTS (comma-separated). Pad with commas so a port doesn't
# substring-match a longer port (e.g. "341" vs "3410").
case ",${LSOF_HOLD_PORTS:-}," in
  *",${port},"*)
    echo "COMMAND     PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME"
    echo "${LSOF_HOLD_COMMAND:-Python}     12345  user   5u   IPv4 0x0000000000000000      0t0  TCP 127.0.0.1:${port} (LISTEN)"
    exit 0 ;;
  *) exit 1 ;;
esac
STUB
  chmod +x "$STUB_DIR/lsof"

  PATH="$STUB_DIR:$PATH"

  # Invocation log for the docker stub (one line per call, "$*"-joined args).
  export DOCKER_LOG="$BATS_TEST_TMPDIR/docker-invocations.log"

  # Invocation log + held-port config for the lsof stub. Per-test tmpdir, so
  # each test sees an empty log at start — no cross-test contamination.
  export LSOF_LOG="$BATS_TEST_TMPDIR/lsof-invocations.log"
  export LSOF_HOLD_PORTS=""
  export LSOF_HOLD_COMMAND="Python"

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

# ── Foundation smoke: lsof stub plumbing ────────────────────────────────────
# Pins the bats lsof stub used by the port-conflict tests: $LSOF_HOLD_PORTS
# (comma-separated) controls which ports the stub reports as LISTEN'd; every
# invocation is appended to $LSOF_LOG so callers can assert on what was probed.
# Kept PERMANENT (test #0) so a silent stub regression — stub off PATH, env
# vars unexported, log unwritable — fails LOUDLY here instead of corrupting
# every downstream port-conflict test with vacuous "no listener" results.

@test "lsof stub: emits listener line for held ports, exits 1 for free ports" {
  # held: stub returns LISTEN row, exit 0
  LSOF_HOLD_PORTS=3410 run lsof -i :3410 -sTCP:LISTEN -P -n
  [ "$status" -eq 0 ]
  [[ "$output" == *"Python"*"127.0.0.1:3410"*"(LISTEN)"* ]]
  # log captured
  grep -q "lsof -i :3410" "$LSOF_LOG"

  # free: stub exits 1, empty stdout
  LSOF_HOLD_PORTS="" run lsof -i :9999 -sTCP:LISTEN -P -n
  [ "$status" -eq 1 ]
  [ -z "$output" ]
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

@test "apply_isolation stamps the com.copilotkit.showcase.isolate label on every service" {
  # The forward-stack self-id label is what lets `showcase reap` identify a
  # harness-owned isolated project even when its slot record + run dir are both
  # gone (a user-supplied --isolate <name> orphan). Drive the REAL rewrite and
  # assert the label landed on the (only) service, right under its rewritten
  # container_name, as a compose-native labels: block.
  require_python3
  load_common
  apply_isolation foo
  local rewritten="$ISOLATE_TMPDIR/docker-compose.local.yml"
  [ -f "$rewritten" ] || fail "rewritten compose not created: $rewritten"
  grep -q 'com.copilotkit.showcase.isolate: "1"' "$rewritten" \
    || fail "self-id label not stamped into the rewritten compose:
$(cat "$rewritten")"
  # The label must sit under a labels: block, not be orphaned at the wrong
  # indent — assert the labels: key is present too.
  grep -q '^    labels:$' "$rewritten" \
    || fail "labels: block missing/mis-indented in the rewritten compose:
$(cat "$rewritten")"
  # And it never touched the source compose (originals stay pristine).
  grep -q 'com.copilotkit.showcase.isolate' "$SHOWCASE_ROOT/docker-compose.local.yml" \
    && fail "source compose was mutated with the label (must rewrite a COPY only)"
  return 0
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
  # Slot 0 is reserved for the base stack, so the auto-picker lands on slot 1;
  # the dead slot 0 is still reaped by the sweep (its ghost project file is
  # gone), the claim just doesn't land there.
  [ "$ISOLATE_SLOT" = "1" ] || fail "expected to claim slot 1 (slot 0 reserved), got: $ISOLATE_SLOT"
  # The reap rm -rf'd the ghost slot dir: only apply_isolation (not the claim)
  # writes a project file, so after a genuine reap the ghost project file must
  # be GONE. (A `run cat`+`!= ghost-proj` check here would pass vacuously on
  # empty output even if the reap never happened.)
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
  _seed_live_owner "$slots/0"   # this bats process — definitely alive (pid + pid.start)

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
  # Slot 0 is reserved for the base stack, so the auto-picker lands on slot 1
  # even though the dead legacy slot 0 was reaped by the sweep.
  [[ "$output" == *"CLAIMED=1"* ]] || fail "dead legacy slot 0 not reaped (claim should be 1, slot 0 reserved): $output"
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
  # Slot 0 is reserved for the base stack, so the auto-picker lands on slot 1.
  # The empty-pid over-age slot 0 was still reaped by the sweep (verified by
  # the slot dir being gone), the claim just doesn't land there.
  [ "$ISOLATE_SLOT" = "1" ] || fail "empty-pid over-age slot 0 leaked or claim path broken; claimed: $ISOLATE_SLOT"
  [ ! -d "$slots/0" ] || fail "empty-pid over-age slot 0 was not reaped"
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
  # Slot 0 is reserved for the base stack, so the auto-picker lands on slot 1.
  # The over-age inconclusive-pid slot 0 was still reaped by the sweep
  # (verified by the ghost project record and orphan run dir being gone), the
  # claim just doesn't land there.
  [ "$ISOLATE_SLOT" = "1" ] || fail "over-age inconclusive-pid slot 0 leaked or claim path broken; claimed: $ISOLATE_SLOT"
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
  # Slot 0 is reserved for the base stack, so the auto-picker lands on slot 1.
  # The dead slot 0 is still reaped by the sweep (verified by the ghost slot
  # dir and orphan run dir being gone), the claim just doesn't land there.
  [ "$ISOLATE_SLOT" = "1" ] || fail "expected slot 1 (slot 0 reserved), got: $ISOLATE_SLOT"
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
  # Slot 0 is reserved for the base stack, so the auto-picker lands on slot 1.
  # The dead slot 0 is still reaped by the sweep (verified by the ghost project
  # record and runs dir being gone), the claim just doesn't land there.
  [ "$ISOLATE_SLOT" = "1" ] || fail "expected slot 1 (slot 0 reserved), got: $ISOLATE_SLOT"
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

@test "a slot whose project record reads the RESERVED 'showcase' is left intact — reap never composes the default stack down" {
  # Reserved-name guard in the REAPER: 'showcase' IS the default stack's
  # compose project name, and it PASSES the charset regex — so a slot record
  # reading 'showcase' (a corrupt record, or one written by an older CLI
  # version before apply_isolation reserved the name) used to make the reap
  # run `compose -p showcase down --remove-orphans --volumes` against the
  # user's LIVE DEFAULT stack, destroying the PocketBase named volume.
  # apply_isolation reserves the name at claim time, but the reaper must not
  # trust records: the reserved name gets the same treatment as the
  # path-traversal guard — warn and leave the whole slot in place for manual
  # inspection (no compose-down, no state removal).
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"
  echo "showcase" > "$slots/0/project"   # passes [a-z0-9][a-z0-9_-]*

  export DOCKER_PS_OUTPUT=""   # no live containers, no pid file → reap path
  : > "$DOCKER_LOG"
  docker version   # sentinel: prove stub+DOCKER_LOG wiring before the claim
  run _claim_isolate_slot
  [ "$status" -eq 0 ] || fail "_claim_isolate_slot failed: $output"

  # A loud warning names the offending record and why it is dangerous.
  # (Checked before any `run grep` clobbers $output.)
  [[ "$output" == *"RESERVED"* ]] \
    || fail "no reserved-name warning printed: $output"
  [[ "$output" == *"$slots/0"* ]] \
    || fail "warning does not name the slot record: $output"

  # The reserved-name slot survives — with its record — for inspection, and
  # the claim moves on to the next free slot (the subshell's mkdir persists
  # on the filesystem even though `run` ran the claim in a subshell).
  [ -d "$slots/0" ] || fail "reserved-name slot 0 was reaped (default stack endangered)"
  run cat "$slots/0/project"
  [ "$status" -eq 0 ] || fail "reserved-name slot 0 record removed"
  [[ "$output" == "showcase" ]] || fail "reserved-name record mangled: $output"
  [ -d "$slots/1" ] || fail "claim did not proceed past the preserved slot 0"

  # NO compose-down of the 'showcase' project may have run — match BOTH
  # compose project-flag spellings (the reaper uses -p; other paths use
  # --project-name). The sentinel proves the stub→log pipeline is live, so
  # this absence check cannot pass vacuously.
  _assert_stub_sentinel_logged
  run grep -E -- "(--project-name|-p) showcase down" "$DOCKER_LOG"
  [ "$status" -ne 0 ] \
    || fail "reap composed the RESERVED 'showcase' project down (live default stack): $output"
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
  # Takeover happened → the sweep ran → the dead slot 0 was reaped. The
  # auto-picker lands on slot 1 (slot 0 reserved for the base stack); the
  # absence of the ghost project record is what proves the sweep ran after the
  # takeover.
  [ "$ISOLATE_SLOT" = "1" ] \
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
  # Takeover + sweep ran: the dead slot 0 was reaped. The auto-picker lands on
  # slot 1 (slot 0 reserved for the base stack); the absence of slot 0's
  # project file (asserted below alongside the lock-residue check) is what
  # proves the sweep ran past the plain-file lock.
  [ "$ISOLATE_SLOT" = "1" ] || fail "plain-file lock wedged the sweep; claimed: $ISOLATE_SLOT"
  [ ! -f "$slots/0/project" ] || fail "ghost project record survived — sweep did not run"
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
  # Slot 0 is reserved for the base stack, so the auto-picker lands on slot 1.
  # What this test really pins is that the claim PROCEEDED past the failed
  # tombstone rm under set -e — landing on any valid slot is sufficient proof.
  [[ "$output" == *"CLAIMED=1"* ]] \
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
  # sweep ran, dead slot 0 reaped. The auto-picker lands on slot 1 (slot 0
  # reserved for the base stack); landing on any valid slot proves the sweep
  # progressed past the failed tombstone disposal.
  [[ "$output" == *"CLAIMED=1"* ]] \
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
  # Slot 0 is reserved for the base stack, so apply_isolation auto-picks slot 1
  # (offset (1+1)*200 = 400): aimock 4010+400=4410, dashboard 3210+400=3610,
  # pocketbase 8090+400=8490.
  [[ "$output" == *"keepme"* ]] || fail "notice missing project name: $output"
  [[ "$output" == *"4410"* ]] || fail "notice missing aimock host port: $output"
  [[ "$output" == *"3610"* ]] || fail "notice missing dashboard host port: $output"
  [[ "$output" == *"8490"* ]] || fail "notice missing pocketbase host port: $output"
  [[ "$output" == *"docker compose -p keepme down"* ]] \
    || fail "notice missing literal teardown command: $output"

  # The keep path's central promise: it does NOT compose-down the kept stack.
  # Match BOTH compose project-flag spellings — restore_isolation's own down
  # uses --project-name, but the reaper (and any keep-branch regression)
  # spells it -p, which a --project-name-only grep would let slip through.
  # (Last, because `run grep` clobbers the $output the notice checks read.)
  _assert_stub_sentinel_logged
  run grep -E -- "(--project-name|-p) keepme down" "$DOCKER_LOG"
  [ "$status" -ne 0 ] || fail "keep path composed the kept stack down: $output"
}

# The survival notice's human-readable hours must track ISOLATE_KEEP_TTL, not a
# hardcoded "(4h)". SHOWCASE_ISOLATE_KEEP_TTL is read at source time, so it must
# be exported BEFORE load_common sources _common.sh.
@test "survival notice's human-readable hours track an overridden ISOLATE_KEEP_TTL (not a stale (4h))" {
  require_python3
  export SHOWCASE_ISOLATE_KEEP_TTL=7200   # 2h, not the 4h default
  load_common
  [ "$ISOLATE_KEEP_TTL" = 7200 ] || fail "precondition: TTL override not picked up, got '$ISOLATE_KEEP_TTL'"
  apply_isolation keepttl

  ISOLATE_KEEP=true
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation failed under keep: $output"

  # The seconds value must reflect the override.
  [[ "$output" == *"7200s"* ]] || fail "notice missing overridden TTL seconds: $output"
  # And the parenthetical hours must NOT contradict it with a stale 4h.
  [[ "$output" != *"(4h)"* ]] || fail "notice still says (4h) for a 2h TTL: $output"
  # The computed hours should read sensibly (2h here).
  [[ "$output" == *"(2h)"* ]] || fail "notice missing computed (2h): $output"
}

@test "survival notice reads sensibly at the default ISOLATE_KEEP_TTL (4h)" {
  require_python3
  load_common
  [ "$ISOLATE_KEEP_TTL" = 14400 ] || fail "precondition: expected default TTL 14400, got '$ISOLATE_KEEP_TTL'"
  apply_isolation keepdef

  ISOLATE_KEEP=true
  run restore_isolation
  [ "$status" -eq 0 ] || fail "restore_isolation failed under keep: $output"

  [[ "$output" == *"14400s"* ]] || fail "notice missing default TTL seconds: $output"
  [[ "$output" == *"(4h)"* ]] || fail "notice missing default (4h): $output"
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
  _seed_live_owner "$slots/0"

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
  _seed_live_owner "$slots/0"
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
  _seed_live_owner "$slots/0"          # live owner — sweep must not reap it
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
  # Slot 0 is reserved for the base stack, so apply_isolation auto-picks slot 1.
  local slotdir="$XDG_STATE_HOME/copilotkit/showcase/slots/1"
  local rundir="$XDG_STATE_HOME/copilotkit/showcase/runs/trapkeep"
  [ -d "$rundir" ]  || fail "kept run dir was torn down by the EXIT trap: $output"
  [ -d "$slotdir" ] || fail "kept slot was released by the EXIT trap: $output"
  [[ "$output" == *"Kept isolated group standing"* ]] \
    || fail "survival notice not printed at exit: $output"

  # The keep path's central promise, under the REAL trap wiring: the EXIT trap
  # did NOT compose-down the kept stack. Match BOTH compose project-flag
  # spellings (--project-name and -p) — a keep-branch regression via the -p
  # form would pass a --project-name-only grep undetected. The log was
  # truncated inside the fixture after apply_isolation's pre-down, and the
  # sentinel proves the stub→log pipeline stayed live, so this absence check
  # is not vacuous.
  _assert_stub_sentinel_logged
  run grep -E -- "(--project-name|-p) trapkeep down" "$DOCKER_LOG"
  [ "$status" -ne 0 ] || fail "EXIT trap composed the kept stack down: $output"
}

# ── SHOWCASE_ISO_SLOT pinning ────────────────────────────────────────────────
#
# When SHOWCASE_ISO_SLOT is exported the picker pins to that slot instead of
# auto-selecting the first free one. Three behaviors are pinned here:
#   1. A free pinned slot is claimed verbatim, even if lower-numbered slots are
#      occupied — the pin BYPASSES auto-selection, doesn't merely seed it.
#   2. A pinned slot that is currently LIVE refuses to steal it — the die
#      message names the liveness state so the user can clear it explicitly.
#   3. Invalid pin values (reserved slot 0, non-numeric, out-of-range) are
#      rejected with the appropriate validation message BEFORE any slot is
#      claimed or reaped.

@test "SHOWCASE_ISO_SLOT=9 claims slot 9 even when 1-3 are pre-occupied" {
  # Pinning bypass: when slots 1, 2, 3 are all live-occupied (live owning PID),
  # the auto-picker would land on slot 4; with SHOWCASE_ISO_SLOT=9 set the
  # picker must skip every lower free slot AND every lower live slot and land
  # on 9 verbatim. Live PID alone (no project file, no docker containers)
  # makes _slot_liveness return "live" via signal #2 (owning-PID liveness),
  # so the sweep leaves the pre-seeded slots intact.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  local n
  for n in 1 2 3; do
    mkdir -p "$slots/$n"
    _seed_live_owner "$slots/$n"   # this bats process — definitely alive (pid + pid.start)
  done

  export SHOWCASE_ISO_SLOT=9
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "9" ] \
    || fail "pinned SHOWCASE_ISO_SLOT=9 did not land on slot 9: got $ISOLATE_SLOT"
  # Offset formula is (slot + 1) * 200 — slot 9 → 2000.
  [ "$ISOLATE_PORT_OFFSET" = "2000" ] \
    || fail "pinned slot 9 port offset wrong: expected 2000, got $ISOLATE_PORT_OFFSET"
  # Slot 9 actually got claimed on disk and the pid file was written by the
  # common post-claim block.
  [ -d "$slots/9" ] || fail "slot 9 dir not created on pin"
  [ -f "$slots/9/pid" ] || fail "slot 9 pid file not written on pin"
  # Pre-occupied slots survive — the pin must not steal/reap them.
  for n in 1 2 3; do
    [ -d "$slots/$n" ] || fail "pre-occupied slot $n was reaped by the pin"
  done
}

@test "SHOWCASE_ISO_SLOT pinned to live slot dies with liveness message" {
  # Live-pin refusal: a pinned slot that is currently live must NOT be stolen.
  # Seed slot 9 with a live owning PID (this bats process) so _slot_liveness 9
  # classifies it as "live" via signal #2 — no docker containers needed.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/9"
  _seed_live_owner "$slots/9"   # this bats process — _slot_liveness → live

  export SHOWCASE_ISO_SLOT=9
  run _claim_isolate_slot
  [ "$status" -ne 0 ] || fail "pin to LIVE slot 9 unexpectedly succeeded: $output"
  [[ "$output" == *"liveness=live"* ]] \
    || fail "die message does not mention the live liveness state: $output"
  # The live slot survives — pin must not touch it.
  [ -d "$slots/9" ] || fail "live slot 9 was reaped by the refused pin"
  run cat "$slots/9/pid"
  [ "$status" -eq 0 ] || fail "live slot 9 pid file vanished after refused pin"
  [[ "$output" == "$$" ]] || fail "live slot 9 pid file mangled: $output"
}

@test "SHOWCASE_ISO_SLOT validates input (0, foo, 99 all rejected)" {
  # Three input-validation branches, one test:
  #   - SHOWCASE_ISO_SLOT=0 → reserved (slot 0 is the base stack)
  #   - SHOWCASE_ISO_SLOT=foo → non-numeric
  #   - SHOWCASE_ISO_SLOT=99 → exceeds ISOLATE_MAX_SLOT (45)
  # All three must die with a message naming the specific failure mode,
  # BEFORE any slot is claimed (so the slots dir stays empty across all
  # three calls).
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"

  # NB: the regex check runs FIRST, so non-numeric values trip the "positive
  # integer" branch even if they would also be out-of-range. Order: numeric
  # regex → >=1 → <=ISOLATE_MAX_SLOT.

  # Reserved slot 0.
  SHOWCASE_ISO_SLOT=0 run _claim_isolate_slot
  [ "$status" -ne 0 ] || fail "SHOWCASE_ISO_SLOT=0 unexpectedly succeeded: $output"
  [[ "$output" == *"slot 0 is reserved"* ]] \
    || fail "SHOWCASE_ISO_SLOT=0 die message does not say 'slot 0 is reserved': $output"

  # Non-numeric.
  SHOWCASE_ISO_SLOT=foo run _claim_isolate_slot
  [ "$status" -ne 0 ] || fail "SHOWCASE_ISO_SLOT=foo unexpectedly succeeded: $output"
  [[ "$output" == *"positive integer"* ]] \
    || fail "SHOWCASE_ISO_SLOT=foo die message does not mention 'positive integer': $output"

  # Out of range (ISOLATE_MAX_SLOT=45, so 99 is over).
  SHOWCASE_ISO_SLOT=99 run _claim_isolate_slot
  [ "$status" -ne 0 ] || fail "SHOWCASE_ISO_SLOT=99 unexpectedly succeeded: $output"
  [[ "$output" == *"exceeds ISOLATE_MAX_SLOT=45"* ]] \
    || fail "SHOWCASE_ISO_SLOT=99 die message does not mention 'exceeds ISOLATE_MAX_SLOT=45': $output"

  # None of the rejected calls claimed a slot — the slots dir contains no
  # numeric entries (the sweep may have created/removed .sweep.lock-shaped
  # entries, but no integer slot dirs).
  if [ -d "$slots" ]; then
    run bash -c "ls -A '$slots' | grep -E '^[0-9]+\$' || true"
    [ -z "$output" ] || fail "rejected pins claimed a slot anyway: $output"
  fi
}

# ── Port-probe and stale-reap behavior (MT3.2c) ──────────────────────────────
#
# Four additional behaviors pinned here:
#   #4. Pinned-path reap-and-retry: a stale slot at the pinned number is reaped
#       and the slot dir re-mkdir'd by the picker on the same call.
#   #5. Post-shift _slot_offset_ports regression: slot 8's dashboard port is
#       now 5010 (3210 + 1800), NOT 5000 (the pre-shift 3200 + 1800). The
#       regression test pins both halves: 5010 present, 5000 absent.
#   #6. Auto-pick port-probe skip: a slot whose dashboard port is held by a
#       FOREIGN process (not docker) is skipped — the picker rmdirs the
#       provisional slot dir and advances to the next slot.
#   #7. Own-project docker-listener filter: a live slot's project sees a
#       com.docker.* listener on one of its ports as the slot's OWN binding
#       (treated as free); a non-docker process name on the same port is NOT
#       filtered (treated as held). This is the port-probe path that lets a
#       --keep'd stack's own docker-proxy listener not be re-flagged as a
#       foreign hold.

@test "SHOWCASE_ISO_SLOT pinned-path reaps stale slot and re-claims successfully" {
  # Stale-reap on pinned: pre-create slot 9 with a project file but NO pid
  # file — _slot_liveness classifies this as "stale" (has_proj=true,
  # pid_file_present=false → stale). The pinned branch should reap-and-retry
  # (rm -rf the slot entry, then mkdir it fresh) and write our pid into the
  # rebuilt slot via the common post-claim block.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/9"
  echo "stale-proj" > "$slots/9/project"   # project recorded, no pid file → stale

  export DOCKER_PS_OUTPUT=""   # no live containers for stale-proj
  export SHOWCASE_ISO_SLOT=9
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "9" ] \
    || fail "pinned stale slot 9 did not re-claim: got $ISOLATE_SLOT"
  # The reap removed the original slot dir + project file; the common
  # post-claim block re-mkdir'd it and wrote our pid. Prove BOTH halves:
  [ -f "$slots/9/pid" ] || fail "post-reap pid file missing on slot 9"
  run cat "$slots/9/pid"
  [ "$status" -eq 0 ] || fail "post-reap pid file unreadable on slot 9"
  [[ "$output" == "$$" ]] \
    || fail "post-reap pid file does not contain reaper's pid: got $output, expected $$"
  # The stale project file should be gone (reap rm -rf'd it; the claim does
  # NOT re-write a project file — only apply_isolation does).
  [ ! -f "$slots/9/project" ] \
    || fail "stale project file survived the reap-and-retry: $(cat "$slots/9/project")"
}

@test "_slot_offset_ports 8 includes 5010 and excludes 5000 (port-shift regression)" {
  # Pre-shift the dashboard base was 3200, so slot 8 (offset 1800) bound 5000.
  # Post-shift the dashboard base is 3210, so slot 8 binds 5010. Pin BOTH halves
  # of the regression: 5010 must be present (the new port emitted by the offset
  # function), AND 5000 must be absent (a stale assumption that would let a
  # foreign 5000 binder collide with slot 8 invisibly). One assertion without
  # the other lets a half-revert (e.g. emitting BOTH 5000 and 5010) slip past.
  load_common
  run _slot_offset_ports 8
  [ "$status" -eq 0 ] || fail "_slot_offset_ports 8 failed: $output"
  [[ "$output" == *"5010"* ]] \
    || fail "_slot_offset_ports 8 did not emit dashboard port 5010 (post-shift): $output"
  ! [[ "$output" == *"5000"* ]] \
    || fail "_slot_offset_ports 8 still emits pre-shift dashboard port 5000: $output"
}

@test "auto-pick skips slot 1 when its dashboard port is held by a foreign process" {
  # Auto-pick port-probe skip: with no SHOWCASE_ISO_SLOT set, the picker walks
  # 1..ISOLATE_MAX_SLOT. Slot 1's dashboard port (3210 + 400 = 3610) is held
  # by a non-docker process (Python — not subject to the own-project filter,
  # which only fires for docker/com.docker process names). The picker must
  # mkdir slot 1, see the port held, rmdir slot 1, and advance to slot 2.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  export LSOF_HOLD_PORTS="3610"
  export LSOF_HOLD_COMMAND="Python"

  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "2" ] \
    || fail "auto-pick did not skip port-held slot 1: claimed $ISOLATE_SLOT"
  # Slot 1 was rmdir'd after the port probe failed; slot 2 was claimed.
  [ ! -d "$slots/1" ] \
    || fail "port-held slot 1 dir survived the picker's rmdir"
  [ -d "$slots/2" ] || fail "slot 2 was not claimed"
  [ -f "$slots/2/pid" ] || fail "slot 2 pid file not written"
}

@test "_slot_ports_free treats own-project docker listeners as free, but not Python" {
  # Own-project filter (port-probe path): a docker / com.docker listener on a
  # port owned by a slot whose project is recorded and live is treated as the
  # slot's OWN binding (returns 0 = "all free"). The same port held by a
  # non-docker process name is NOT filtered (returns 1 = "held"). This is
  # what lets a --keep'd stack's own docker-proxy not be re-flagged as a
  # foreign hold.
  #
  # The brief originally proposed exercising this via the pinned-path's
  # EEXIST branch with a live slot, but that path DIES on a live pin before
  # reaching the port probe — so the own-project filter is not observable
  # from _claim_isolate_slot directly. We test _slot_ports_free in isolation,
  # which is the function that actually implements the filter.
  #
  # Pinning slot 8 as live: write the project file + a live pid ($$). Slot 8's
  # dashboard port post-shift is 3210 + 1800 = 5010.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/8"
  echo "iso8-proj" > "$slots/8/project"
  _seed_live_owner "$slots/8"   # _slot_liveness 8 → live (pid live + pid.start, no containers needed)

  # Case A: docker listener on slot 8's dashboard port → filtered as own-project.
  export DOCKER_PS_OUTPUT=""   # no docker containers; pid-liveness still wins
  export LSOF_HOLD_PORTS="5010"
  export LSOF_HOLD_COMMAND="com.docker.backend"
  run _slot_ports_free 8
  [ "$status" -eq 0 ] \
    || fail "_slot_ports_free 8 should treat com.docker.backend on own port as free, got status=$status output=$output"

  # Case B: same port held by Python (non-docker) → NOT filtered, returns 1.
  export LSOF_HOLD_COMMAND="Python"
  run _slot_ports_free 8
  [ "$status" -ne 0 ] \
    || fail "_slot_ports_free 8 should treat Python listener on own port as held (foreign), got status=0 output=$output"
  [[ "$output" == *"Slot 8 port 5010 held by Python"* ]] \
    || fail "_slot_ports_free 8 did not emit the foreign-hold info line for Python: $output"
}

@test "_slot_ports_free fails LOUDLY for a bad slot instead of falsely reporting all-free" {
  # Regression: _slot_ports_free fed its port list from
  #   while read port; do ...; done < <(_slot_offset_ports "$slot")
  # When _slot_offset_ports dies on a bad slot (out-of-range / non-numeric), the
  # die only kills the process-substitution SUBSHELL — not _slot_ports_free. The
  # while loop then read ZERO ports, any_held stayed 0, and the function returned
  # 0 ("all ports free"), SILENTLY defeating the port-conflict guard for a bad
  # slot. Both claim paths treat 0 as "free, go claim it", so a bad slot would
  # have sailed past the guard. The fix captures the port list (and thus
  # _slot_offset_ports's exit status) BEFORE the loop, so a bad slot fails LOUDLY.
  load_common
  export LSOF_HOLD_PORTS=""

  # Out-of-range slot (ISOLATE_MAX_SLOT=45). _slot_offset_ports dies on this.
  run _slot_ports_free 99
  [ "$status" -ne 0 ] \
    || fail "_slot_ports_free 99 (out-of-range) wrongly reported success; the bad slot defeated the guard. status=$status output=$output"
  [[ "$output" == *"exceeds ISOLATE_MAX_SLOT"* ]] \
    || fail "_slot_ports_free 99 did not surface the _slot_offset_ports die reason: $output"

  # Non-numeric slot. _slot_offset_ports dies on this too.
  run _slot_ports_free "bogus"
  [ "$status" -ne 0 ] \
    || fail "_slot_ports_free bogus (non-numeric) wrongly reported success. status=$status output=$output"
  [[ "$output" == *"non-negative integer"* ]] \
    || fail "_slot_ports_free bogus did not surface the _slot_offset_ports die reason: $output"
}

@test "_slot_ports_free still reports a valid slot correctly (free when free, held when held)" {
  # Guard the fix: valid slots must NOT regress. Slot 8's dashboard port post-
  # shift is 3210 + 1800 = 5010 (same arithmetic as the own-project test above).
  load_common

  # Free: nothing held → returns 0.
  export LSOF_HOLD_PORTS=""
  run _slot_ports_free 8
  [ "$status" -eq 0 ] \
    || fail "_slot_ports_free 8 should be free when no port is held, got status=$status output=$output"

  # Held by a foreign (non-docker) process on slot 8's dashboard port → returns 1.
  export LSOF_HOLD_PORTS="5010"
  export LSOF_HOLD_COMMAND="Python"
  run _slot_ports_free 8
  [ "$status" -ne 0 ] \
    || fail "_slot_ports_free 8 should be held when port 5010 is taken by Python, got status=0 output=$output"
  [[ "$output" == *"Slot 8 port 5010 held by Python"* ]] \
    || fail "_slot_ports_free 8 did not emit the foreign-hold info line: $output"
}

# ── Composite tests (MT3.2d): _slot_state axes, bin/showcase slots, concurrent claim ──
#
# Three additional behaviors pinned here:
#   #8.  _slot_state emits one pipe-delimited line carrying ALL 7 axes (slot,
#        dir, pid, liveness, ports, offset, project) for a populated slot — the
#        wire format that `bin/showcase slots` parses.
#   #9.  `bin/showcase slots` enumerates ALL 46 slots (0..ISOLATE_MAX_SLOT=45)
#        with a header row and the special "showcase (base)" project label for
#        slot 0 — the table contract the CLI exposes to operators.
#   #10. Two concurrent `_claim_isolate_slot` invocations land on DISTINCT
#        slots — atomic mkdir is the synchronization primitive; no two
#        claimants ever end up owning the same slot.

@test "_slot_state 5 reports all axes for a live populated slot" {
  # The wire format: one pipe-delimited line of 7 fields, exactly as
  # cmd-slots.sh's `IFS='|' read -r slot dir pid liveness ports offset project`
  # consumes them. Seed slot 5 with a project record AND a live owning pid
  # (this bats process) so _slot_liveness 5 returns "live" via signal #2 — no
  # docker containers needed. Slot 5's offset is (5+1)*200 = 1200.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/5"
  echo "iso5-proj" > "$slots/5/project"
  _seed_live_owner "$slots/5"   # this bats process — _slot_liveness → live (pid + pid.start)

  # No held ports → _slot_ports_free returns 0 → ports="free".
  export LSOF_HOLD_PORTS=""
  run _slot_state 5
  [ "$status" -eq 0 ] || fail "_slot_state 5 failed: $output"
  # Exactly one output line.
  [ "${#lines[@]}" -eq 1 ] \
    || fail "_slot_state emitted ${#lines[@]} lines, expected 1: $output"

  # Parse the 7 pipe-delimited axes. `read -ra fields` on a single line under
  # IFS='|' gives one field per axis — independent of bats's line-splitting.
  local -a fields
  IFS='|' read -ra fields <<< "$output"
  [ "${#fields[@]}" -eq 7 ] \
    || fail "_slot_state emitted ${#fields[@]} fields, expected 7 (slot|dir|pid|liveness|ports|offset|project): $output"

  [ "${fields[0]}" = "5" ]          || fail "axis[0] slot wrong: got '${fields[0]}', expected '5'"
  [ "${fields[1]}" = "present" ]    || fail "axis[1] dir wrong: got '${fields[1]}', expected 'present'"
  [ "${fields[2]}" = "$$" ]         || fail "axis[2] pid wrong: got '${fields[2]}', expected '$$'"
  [ "${fields[3]}" = "live" ]       || fail "axis[3] liveness wrong: got '${fields[3]}', expected 'live'"
  [ "${fields[4]}" = "free" ]       || fail "axis[4] ports wrong: got '${fields[4]}', expected 'free' (no LSOF_HOLD_PORTS)"
  [ "${fields[5]}" = "1200" ]       || fail "axis[5] offset wrong: got '${fields[5]}', expected '1200' (=(5+1)*200)"
  [ "${fields[6]}" = "iso5-proj" ]  || fail "axis[6] project wrong: got '${fields[6]}', expected 'iso5-proj'"
}

@test "bin/showcase slots prints all 46 slots with header and special slot 0 project label" {
  # End-to-end contract for `showcase slots`: with no slots pre-claimed, the
  # default fixed-width table emits one header row + 46 data rows (slots
  # 0..ISOLATE_MAX_SLOT=45), and slot 0's project column shows the special
  # "showcase (base)" label that cmd-slots.sh injects (the on-disk record is
  # never set for slot 0 — it's reserved for the base stack).
  #
  # XDG_STATE_HOME is already set to the per-test scratch dir by setup(), so
  # the slots dir starts empty and every row reports dir=absent.
  # The docker/lsof stubs in $STUB_DIR are on PATH and stay on PATH for the
  # child shell, so no real docker/lsof is hit; _slot_liveness short-circuits
  # to "inconclusive" for absent dirs (no docker call).

  # bin/showcase lives at the repo's showcase/bin/showcase, two dirs up from
  # this test file (scripts/__tests__/ → showcase/, then bin/showcase).
  run bash "$BATS_TEST_DIRNAME/../../bin/showcase" slots
  [ "$status" -eq 0 ] || fail "bin/showcase slots failed: $output"

  # ≥47 lines: 1 header + 46 data rows.
  [ "${#lines[@]}" -ge 47 ] \
    || fail "bin/showcase slots emitted ${#lines[@]} lines, expected >=47 (1 header + 46 rows): $output"

  # Header: first non-blank line starts with "SLOT" (the fixed-width table's
  # header row, per cmd-slots.sh: `printf '%-4s ... "SLOT" "DIR" ...`).
  local first_nonblank=""
  local line
  for line in "${lines[@]}"; do
    if [ -n "${line// /}" ]; then
      first_nonblank="$line"
      break
    fi
  done
  [[ "$first_nonblank" == SLOT* ]] \
    || fail "first non-blank line is not the SLOT header: '$first_nonblank'"

  # Slot 0's special project label "showcase (base)" must appear (cmd-slots.sh
  # injects it for slot 0 regardless of the on-disk record).
  [[ "$output" == *"showcase (base)"* ]] \
    || fail "slot 0 project label 'showcase (base)' missing: $output"

  # Exactly 46 data rows: lines starting with a digit + whitespace (the
  # printf format opens with %-4s for the slot number, so data rows start
  # with a digit followed by spaces; the header line starts with "SLOT").
  local data_rows=0
  for line in "${lines[@]}"; do
    if [[ "$line" =~ ^[0-9]+[[:space:]] ]]; then
      data_rows=$((data_rows + 1))
    fi
  done
  [ "$data_rows" -eq 46 ] \
    || fail "expected 46 data rows (slots 0..45), got $data_rows: $output"
}

@test "concurrent _claim_isolate_slot calls claim distinct slots (no double-claim)" {
  # Atomic-mkdir lock under concurrency: two _claim_isolate_slot invocations
  # running simultaneously must NEVER both land on the same slot. Bats runs
  # in a single process so we spawn the two claims as background subshells
  # (`&`) and wait for both — the atomic-mkdir lock in _claim_isolate_slot
  # is the synchronization primitive. Slots 1-8 are pre-occupied with live
  # owning PIDs so the auto-picker is forced to evaluate slots 9 and 10.
  load_common
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  local n
  for n in 1 2 3 4 5 6 7 8; do
    mkdir -p "$slots/$n"
    _seed_live_owner "$slots/$n"   # this bats process — definitely alive (pid + pid.start)
  done

  # No held ports for any slot's offset range → _slot_ports_free returns 0
  # for whichever slot the picker probes.
  export LSOF_HOLD_PORTS=""
  export DOCKER_PS_OUTPUT=""

  # Spawn two subshell claims concurrently. Each subshell writes its result
  # (the claimed ISOLATE_SLOT and its own subshell pid) to a file the parent
  # can read after wait(); ISOLATE_SLOT itself is a variable inside each
  # subshell and doesn't propagate back to the parent. The filesystem state
  # under $slots/ is the real source of truth for "did they double-claim".
  local out1="$BATS_TEST_TMPDIR/claim1.out"
  local out2="$BATS_TEST_TMPDIR/claim2.out"
  (
    _claim_isolate_slot
    printf 'slot=%s pid=%s\n' "$ISOLATE_SLOT" "$BASHPID" > "$out1"
  ) &
  local p1=$!
  # Tiny stagger so both subshells exist before the second's mkdir loop —
  # without this the second can finish before the first ever enters the loop,
  # serializing them (still correct, but doesn't exercise the concurrent path).
  sleep 0.05
  (
    _claim_isolate_slot
    printf 'slot=%s pid=%s\n' "$ISOLATE_SLOT" "$BASHPID" > "$out2"
  ) &
  local p2=$!
  wait "$p1" || fail "subshell 1 (_claim_isolate_slot) failed"
  wait "$p2" || fail "subshell 2 (_claim_isolate_slot) failed"

  # Both wrote their result files.
  [ -f "$out1" ] || fail "subshell 1 did not produce $out1"
  [ -f "$out2" ] || fail "subshell 2 did not produce $out2"

  # Filesystem proof: BOTH slots 9 AND 10 exist with pid files. The picker
  # walks 1..ISOLATE_MAX_SLOT, skips the live-occupied 1-8 (each carries
  # this bats process's pid → liveness=live), and the two concurrent claims
  # land on the next two free slots.
  [ -d "$slots/9" ]  || fail "slot 9 was not claimed (no concurrent landing): $(ls -1 "$slots")"
  [ -d "$slots/10" ] || fail "slot 10 was not claimed (no concurrent landing): $(ls -1 "$slots")"
  [ -f "$slots/9/pid" ]  || fail "slot 9 has no pid file (claim did not write owner): $(ls -1 "$slots/9")"
  [ -f "$slots/10/pid" ] || fail "slot 10 has no pid file (claim did not write owner): $(ls -1 "$slots/10")"

  # No double-claim: the two subshells reported DIFFERENT slot numbers in
  # their own ISOLATE_SLOT — proving they followed disjoint paths through the
  # auto-pick loop. (The pid files themselves carry $$ — the parent bats PID,
  # which a subshell inherits unchanged — so identical pid file contents is
  # NOT evidence of double-claim; the slot-number divergence is.)
  local result1 result2
  result1="$(cat "$out1" 2>/dev/null || true)"
  result2="$(cat "$out2" 2>/dev/null || true)"
  local slot1 slot2
  slot1="$(printf '%s' "$result1" | sed -E 's/^slot=([0-9]+).*/\1/')"
  slot2="$(printf '%s' "$result2" | sed -E 's/^slot=([0-9]+).*/\1/')"
  [ -n "$slot1" ] || fail "subshell 1 did not record a slot: result1='$result1'"
  [ -n "$slot2" ] || fail "subshell 2 did not record a slot: result2='$result2'"
  [ "$slot1" != "$slot2" ] \
    || fail "subshell 1 and subshell 2 both claimed slot $slot1 (double-claim): result1='$result1' result2='$result2'"

  # Slot-numbers must each be 9 OR 10 (the two slots the auto-picker reaches
  # after skipping the live-occupied 1-8).
  case "$slot1" in 9|10) ;; *) fail "subshell 1 claimed unexpected slot $slot1 (expected 9 or 10): $result1" ;; esac
  case "$slot2" in 9|10) ;; *) fail "subshell 2 claimed unexpected slot $slot2 (expected 9 or 10): $result2" ;; esac
}

@test "_slot_state emits ports=? when lsof is unavailable" {
  # Passive-inspector forgiveness: `bin/showcase slots` calls _slot_state for
  # every present slot, and _slot_state's port-probe goes through
  # _slot_ports_free — which dies hard when lsof is missing. That die is the
  # right contract for the picker (--isolate genuinely needs lsof), but it
  # makes the read-only `slots` table unusable on lsof-less hosts. Fix:
  # _slot_state short-circuits to ports="?" when lsof is unavailable, leaving
  # _slot_ports_free's die intact for the picker path.
  load_common
  # Seed slot 0 as present so _slot_state takes the probe branch (dir=absent
  # would leave ports="-" and bypass the lsof check entirely).
  local slots="$XDG_STATE_HOME/copilotkit/showcase/slots"
  mkdir -p "$slots/0"

  # Hide the stub lsof by pointing PATH at an empty dir — done AFTER
  # load_common so the harness's stub wiring is already in place and we are
  # specifically simulating "lsof not installed".
  local empty_bin="$BATS_TEST_TMPDIR/no-lsof-bin"
  mkdir -p "$empty_bin"
  local saved_path="$PATH"
  PATH="$empty_bin"

  # _slot_state must not die; the ports field (axis #5, between the 4th and
  # 5th pipes) must be "?".
  local state
  state=$(_slot_state 0)
  local rc=$?

  PATH="$saved_path"

  [ "$rc" -eq 0 ] || fail "_slot_state 0 failed (rc=$rc) with lsof unavailable: $state"
  [ -n "$state" ] || fail "_slot_state 0 emitted no output with lsof unavailable"
  [[ "$state" == *"|?|"* ]] \
    || fail "_slot_state did not degrade to ports='?' when lsof was unavailable: $state"
}

# ── --isolate=<N> arg-parser sugar (cmd-test.sh) ─────────────────────────────
#
# The `--isolate=<N>` form is sugar over `SHOWCASE_ISO_SLOT=<N> ... --isolate`:
# the arg parser in cmd-test.sh sets SHOWCASE_ISO_SLOT from the =<N> suffix and
# exports it, then the existing picker (_claim_isolate_slot) handles ALL
# validation. The tests here pin the parser→env→picker pipeline end-to-end by
# replaying cmd-test.sh's --isolate=* branch verbatim and then invoking the
# picker (the SAME wiring bin/showcase test would do). No new validation logic
# exists in the arg parser, so we don't re-test validation here — we prove the
# arg form drives the existing validation paths pinned above.
#
# We replay the parser branch rather than invoking `cmd_test` directly because
# cmd_test runs heavy work (need_slug, trap restore_isolation, apply_isolation
# which forks docker/python3) after parsing — orthogonal to what this test
# pins.

@test "--isolate=<N> arg form exports SHOWCASE_ISO_SLOT and pins the slot through the picker" {
  load_common
  # Replay cmd-test.sh's `--isolate=*` branch verbatim, then run the picker.
  set -- --isolate=9 dummy-slug
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --isolate=*)
        SHOWCASE_ISO_SLOT="${1#--isolate=}"
        export SHOWCASE_ISO_SLOT
        shift
        ;;
      *) shift ;;
    esac
  done
  [ "$SHOWCASE_ISO_SLOT" = "9" ] \
    || fail "--isolate=9 did not export SHOWCASE_ISO_SLOT=9; got: $SHOWCASE_ISO_SLOT"

  # The exported pin drives the picker exactly as the SHOWCASE_ISO_SLOT=9
  # pinned-path test does (pinned by "SHOWCASE_ISO_SLOT=9 claims slot 9 ..."
  # above): slot 9 claimed verbatim.
  _claim_isolate_slot
  [ "$ISOLATE_SLOT" = "9" ] \
    || fail "picker did not honor --isolate=9-exported SHOWCASE_ISO_SLOT: got $ISOLATE_SLOT"
}

@test "--isolate=0 arg form drives the picker's reserved-slot rejection" {
  # Wiring proof: the arg parser does NO validation of N itself — it relies on
  # the picker. So --isolate=0 must trip the SAME 'slot 0 is reserved' die
  # pinned by "SHOWCASE_ISO_SLOT validates input (0, foo, 99 all rejected)"
  # above. Replay the parser branch, then invoke the picker.
  load_common
  set -- --isolate=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --isolate=*)
        SHOWCASE_ISO_SLOT="${1#--isolate=}"
        export SHOWCASE_ISO_SLOT
        shift
        ;;
      *) shift ;;
    esac
  done
  [ "$SHOWCASE_ISO_SLOT" = "0" ] || fail "parser did not export 0: got $SHOWCASE_ISO_SLOT"

  run _claim_isolate_slot
  [ "$status" -ne 0 ] || fail "--isolate=0 unexpectedly succeeded: $output"
  [[ "$output" == *"slot 0 is reserved"* ]] \
    || fail "--isolate=0 did not surface the reserved-slot die: $output"
}

@test "cmd-test.sh --isolate=<N> actually wires the arg through to SHOWCASE_ISO_SLOT" {
  # Drift guard: the three tests above replay the parser branch verbatim. This
  # test sources the REAL cmd-test.sh and runs cmd_test end-to-end with a stub
  # apply_isolation that snapshots SHOWCASE_ISO_SLOT — so if the parser branch
  # is ever removed or wired differently, this fails LOUDLY.
  load_common

  local snapshot="$BATS_TEST_TMPDIR/iso-slot-snapshot"
  local cmd_test_sh="$BATS_TEST_DIRNAME/../cli/cmd-test.sh"
  [ -f "$cmd_test_sh" ] || fail "cmd-test.sh not found: $cmd_test_sh"

  # Stub apply_isolation: snapshot SHOWCASE_ISO_SLOT, then exit cleanly via
  # `die` so the rest of cmd_test (which forks docker/etc) never runs.
  # Stub need_slug to a no-op so the parser path is what's exercised.
  # Stub everything else cmd_test invokes after the parser to no-ops.
  run bash -euo pipefail -c "
    source '$COMMON'
    source '$cmd_test_sh'
    apply_isolation() { printf '%s\n' \"\${SHOWCASE_ISO_SLOT:-<unset>}\" > '$snapshot'; exit 0; }
    need_slug() { :; }
    info() { :; }
    run_harness() { :; }
    cmd_test --isolate=7 dummy-slug
  "
  [ "$status" -eq 0 ] || fail "cmd_test --isolate=7 failed: $output"
  [ -f "$snapshot" ] || fail "stubbed apply_isolation never fired (parser/use_isolate wiring broken)"
  run cat "$snapshot"
  [[ "$output" == "7" ]] \
    || fail "cmd-test.sh did not export SHOWCASE_ISO_SLOT=7 from --isolate=7: got '$output'"
}

@test "--isolate=99 arg form drives the picker's out-of-range rejection" {
  # Same wiring proof for the upper bound: ISOLATE_MAX_SLOT=45, so 99 is over.
  load_common
  set -- --isolate=99
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --isolate=*)
        SHOWCASE_ISO_SLOT="${1#--isolate=}"
        export SHOWCASE_ISO_SLOT
        shift
        ;;
      *) shift ;;
    esac
  done
  [ "$SHOWCASE_ISO_SLOT" = "99" ] || fail "parser did not export 99: got $SHOWCASE_ISO_SLOT"

  run _claim_isolate_slot
  [ "$status" -ne 0 ] || fail "--isolate=99 unexpectedly succeeded: $output"
  [[ "$output" == *"exceeds ISOLATE_MAX_SLOT=45"* ]] \
    || fail "--isolate=99 did not surface the out-of-range die: $output"
}

# ── --isolate <name> space-form arg-parser (cmd-test.sh) ─────────────────────
#
# The space-separated `--isolate <name>` form (vs the `--isolate=<name>` sugar)
# is parsed entirely inside cmd-test.sh's option loop, which must bind the
# explicit name to ISOLATE's name slot and the service to the positional slug
# REGARDLESS of token order — `--isolate <name> <slug>` (name first) and
# `<slug> --isolate <name>` (slug first) must both resolve correctly. The
# auto-named form (`--isolate <slug>` with NO explicit name) must still treat
# the lone trailing token as the slug. And a bare/empty `--isolate=` (or
# `--isolate` with no value) must be REJECTED loudly, never silently auto-pick.
#
# These tests drive the REAL cmd_test parser end-to-end (the same source +
# stub-after-parser pattern as the --isolate=<N> drift guard above): they stub
# everything cmd_test invokes after parsing (apply_isolation, run-harness, etc.)
# and snapshot the parsed slug + isolate_name so a parser regression fails
# LOUDLY. apply_isolation receives ("$isolate_name" "$slug") in that order
# (see _common.sh), so the snapshot records the two positional args it was
# handed — exactly the contract downstream depends on.

# _run_cmd_test_parse <args...> — source the real cmd-test.sh, stub the entire
# post-parser body, and snapshot what the parser bound. Writes two files:
#   $PARSE_SNAP.name  → the isolate name apply_isolation was handed ($1)
#   $PARSE_SNAP.slug  → the slug apply_isolation was handed ($2)
# When --isolate is NOT requested, apply_isolation never fires; the no-isolate
# fallback stub records need_slug's argument as the slug and "<no-iso>" name.
# Sets $status/$output via `run`.
_run_cmd_test_parse() {
  local cmd_test_sh="$BATS_TEST_DIRNAME/../cli/cmd-test.sh"
  [ -f "$cmd_test_sh" ] || fail "cmd-test.sh not found: $cmd_test_sh"
  PARSE_SNAP="$BATS_TEST_TMPDIR/parse-snap"
  rm -f "$PARSE_SNAP".name "$PARSE_SNAP".slug
  # apply_isolation snapshots (name, slug) then exits cleanly so the docker/
  # python3-forking remainder of cmd_test never runs. need_slug snapshots the
  # slug too (and preserves its real "slug required" die so the empty-slug
  # contract is exercised). info/success/warn are silenced; the harness call is
  # a no-op (it is never reached — apply_isolation exits first when isolating).
  run bash -euo pipefail -c "
    source '$COMMON'
    source '$cmd_test_sh'
    apply_isolation() {
      printf '%s' \"\${1:-}\" > '$PARSE_SNAP.name'
      printf '%s' \"\${2:-}\" > '$PARSE_SNAP.slug'
      exit 0
    }
    need_slug() {
      [ -n \"\${1:-}\" ] || die 'slug required'
      printf '<no-iso>' > '$PARSE_SNAP.name'
      printf '%s' \"\${1:-}\" > '$PARSE_SNAP.slug'
    }
    info() { :; }
    success() { :; }
    npx() { :; }
    cmd_test $*
  "
}

@test "cmd-test.sh --isolate <name> <slug> (name BEFORE slug) binds name and slug correctly" {
  load_common
  _run_cmd_test_parse --isolate myname mastra
  [ "$status" -eq 0 ] || fail "cmd_test --isolate myname mastra failed: $output"
  [ -f "$PARSE_SNAP.name" ] || fail "apply_isolation never fired (use_isolate wiring broken): $output"
  run cat "$PARSE_SNAP.name"
  [[ "$output" == "myname" ]] || fail "name-before-slug bound wrong isolate name: got '$output' (want myname)"
  run cat "$PARSE_SNAP.slug"
  [[ "$output" == "mastra" ]] || fail "name-before-slug bound wrong slug: got '$output' (want mastra)"
}

@test "cmd-test.sh <slug> --isolate <name> (slug BEFORE name) still binds name and slug correctly" {
  load_common
  _run_cmd_test_parse mastra --isolate myname
  [ "$status" -eq 0 ] || fail "cmd_test mastra --isolate myname failed: $output"
  run cat "$PARSE_SNAP.name"
  [[ "$output" == "myname" ]] || fail "slug-before-name bound wrong isolate name: got '$output' (want myname)"
  run cat "$PARSE_SNAP.slug"
  [[ "$output" == "mastra" ]] || fail "slug-before-name bound wrong slug: got '$output' (want mastra)"
}

@test "cmd-test.sh --isolate <slug> (no explicit name) treats the lone token as the slug (auto-named)" {
  load_common
  _run_cmd_test_parse --isolate mastra
  [ "$status" -eq 0 ] || fail "cmd_test --isolate mastra failed: $output"
  run cat "$PARSE_SNAP.name"
  [[ "$output" == "" ]] || fail "auto-named --isolate wrongly bound an explicit name: got '$output' (want empty)"
  run cat "$PARSE_SNAP.slug"
  [[ "$output" == "mastra" ]] || fail "auto-named --isolate bound wrong slug: got '$output' (want mastra)"
}

@test "cmd-test.sh --isolate <name> <slug> with surrounding flags binds name and slug correctly" {
  load_common
  _run_cmd_test_parse --d5 --isolate d5verify agno --verbose
  [ "$status" -eq 0 ] || fail "cmd_test with flags around --isolate failed: $output"
  run cat "$PARSE_SNAP.name"
  [[ "$output" == "d5verify" ]] || fail "flagged name-before-slug bound wrong name: got '$output' (want d5verify)"
  run cat "$PARSE_SNAP.slug"
  [[ "$output" == "agno" ]] || fail "flagged name-before-slug bound wrong slug: got '$output' (want agno)"
}

@test "cmd-test.sh bare --isolate= (empty value) is rejected loudly, never silently auto-picks" {
  load_common
  _run_cmd_test_parse --isolate= mastra
  [ "$status" -ne 0 ] || fail "bare --isolate= unexpectedly succeeded (silent auto-pick): $output"
  # It must NOT have reached apply_isolation with an empty pin and proceeded.
  [ ! -f "$PARSE_SNAP.slug" ] || fail "bare --isolate= fell through to apply_isolation instead of erroring: name='$(cat "$PARSE_SNAP.name" 2>/dev/null)' slug='$(cat "$PARSE_SNAP.slug" 2>/dev/null)'"
  [[ "$output" == *"isolate"* ]] || fail "bare --isolate= error did not mention isolate: $output"
}

@test "cmd-test.sh --isolate=<name> (non-numeric sugar) binds the explicit name, not a slot" {
  load_common
  # The =<name> sugar is equivalent to the space form `--isolate <name>`: a
  # non-numeric value is an explicit isolate name, NOT a slot pin (a slot pin
  # would die in the picker on "must be a positive integer"). SHOWCASE_ISO_SLOT
  # must remain unset so the picker auto-picks a slot for the named project.
  local snap="$BATS_TEST_TMPDIR/iso-namesugar-snap"
  local cmd_test_sh="$BATS_TEST_DIRNAME/../cli/cmd-test.sh"
  run bash -euo pipefail -c "
    source '$COMMON'
    source '$cmd_test_sh'
    apply_isolation() {
      printf '%s' \"\${SHOWCASE_ISO_SLOT:-<unset>}\" > '$snap.slot'
      printf '%s' \"\${1:-}\" > '$snap.name'
      printf '%s' \"\${2:-}\" > '$snap.slug'
      exit 0
    }
    need_slug() { :; }
    info() { :; }
    success() { :; }
    npx() { :; }
    cmd_test --isolate=d5verify agno
  "
  [ "$status" -eq 0 ] || fail "cmd_test --isolate=d5verify agno failed: $output"
  run cat "$snap.slot"
  [[ "$output" == "<unset>" ]] || fail "--isolate=d5verify wrongly pinned a slot: SHOWCASE_ISO_SLOT='$output'"
  run cat "$snap.name"
  [[ "$output" == "d5verify" ]] || fail "--isolate=d5verify bound wrong name: got '$output'"
  run cat "$snap.slug"
  [[ "$output" == "agno" ]] || fail "--isolate=d5verify bound wrong slug: got '$output'"
}

@test "cmd-test.sh --isolate=<N> numeric pinned path is unchanged (still exports the slot)" {
  load_common
  # Regression guard for the existing numeric sugar: --isolate=7 must still
  # export SHOWCASE_ISO_SLOT=7 and reach apply_isolation with an EMPTY name and
  # the real slug (the picker, not the parser, owns numeric validation).
  local snap="$BATS_TEST_TMPDIR/iso-num-snap"
  local cmd_test_sh="$BATS_TEST_DIRNAME/../cli/cmd-test.sh"
  run bash -euo pipefail -c "
    source '$COMMON'
    source '$cmd_test_sh'
    apply_isolation() {
      printf '%s' \"\${SHOWCASE_ISO_SLOT:-<unset>}\" > '$snap.slot'
      printf '%s' \"\${1:-}\" > '$snap.name'
      printf '%s' \"\${2:-}\" > '$snap.slug'
      exit 0
    }
    need_slug() { :; }
    info() { :; }
    success() { :; }
    npx() { :; }
    cmd_test --isolate=7 mastra
  "
  [ "$status" -eq 0 ] || fail "cmd_test --isolate=7 mastra failed: $output"
  run cat "$snap.slot"
  [[ "$output" == "7" ]] || fail "--isolate=7 did not export SHOWCASE_ISO_SLOT=7: got '$output'"
  run cat "$snap.name"
  [[ "$output" == "" ]] || fail "--isolate=7 wrongly bound a name: got '$output'"
  run cat "$snap.slug"
  [[ "$output" == "mastra" ]] || fail "--isolate=7 bound wrong slug: got '$output'"
}
