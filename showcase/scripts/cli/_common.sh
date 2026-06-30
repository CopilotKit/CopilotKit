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
  # Dereference tools/, shared-tools/, and _shared/ symlinks into real copies
  # so Docker COPY can follow them (Docker build contexts can't traverse
  # symlinks that point outside the context). `_shared` carries the
  # single-source CVDIAG bootstrap module into each Python integration context.
  for pkg_dir in "$SHOWCASE_ROOT"/integrations/*/; do
    for link_name in tools shared-tools _shared; do
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
  # Restore tools/, shared-tools/, and _shared/ symlinks replaced by
  # stage_shared. The integrations/*/_shared glob also matches the canonical
  # source dir integrations/_shared (a real tracked dir) — harmless no-op there.
  (cd "$SHOWCASE_ROOT" && git checkout -- integrations/*/tools integrations/*/shared-tools integrations/*/_shared 2>/dev/null || true)
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
# Set true by cmd-test.sh when --keep is parsed; read by restore_isolation.
# Deliberately a namespaced GLOBAL (not a `local` in cmd_test): the EXIT trap
# fires at top-level script exit, after cmd_test has returned and its locals
# have unwound. Initializing it here also shields against a stray `keep`-like
# env var exported by the user flipping teardown behavior.
ISOLATE_KEEP=false

# Runtime state (slot registry + per-run scratch dirs) lives under
# XDG_STATE_HOME, NOT /tmp — /tmp is world-writable (which made stale-slot
# reaping racy) and gets wiped on reboot (which destroyed the registry/run-dir
# state out from under any surviving docker resources). NB this does NOT make
# --keep reboot-proof: container-liveness protection counts only RUNNING
# containers, so after a reboot (or daemon restart / manual docker stop) the
# kept stack's stopped containers no longer protect its slot — the next
# claim's sweep reclaims it, composing the remnants down (see
# _reap_isolate_slot).
_showcase_state_base() { printf '%s/copilotkit/showcase' "${XDG_STATE_HOME:-$HOME/.local/state}"; }

# Single-user assumption: the slot registry is PER-USER (XDG state), while
# docker compose project names and host ports are HOST-global. Two different
# UNIX users running --isolate concurrently on one host each get their own
# registry, so neither the slot claim nor the duplicate-name guard can see
# the other user's claims — identical port offsets or same-name projects can
# collide across users. Accepted: dev hosts are effectively single-user.
# Note the pid-liveness checks share this assumption: `kill -0` on another
# user's live pid returns EPERM (read here as "dead"), so cross-user slot
# protection via pid is also unreliable.
ISOLATE_SLOT_DIR="$(_showcase_state_base)/slots"
ISOLATE_STALE_THRESHOLD=7200  # 2 hours in seconds — slot-age fallback
# TTL on a `kept` stack (running containers whose owning process is gone or
# unverifiable — a forgotten `--keep` leak). Once a kept slot's age exceeds this
# TTL it is reclassified `stale` and reaped by the sweep, so a --keep'd stack
# left running with no owner cannot accumulate indefinitely. Default 4 hours.
# Overridable via SHOWCASE_ISOLATE_KEEP_TTL (e.g. for tests / longer sessions).
ISOLATE_KEEP_TTL="${SHOWCASE_ISOLATE_KEEP_TTL:-14400}"  # 4 hours in seconds
# The sweep lock is held only for the duration of one sweep pass (seconds, even
# with all 46 slots populated). A crashed sweeper's leftover lock must not
# disable stale reaping for the full 2-hour SLOT threshold — give the lock its
# own, much shorter staleness threshold.
ISOLATE_SWEEP_LOCK_STALE_THRESHOLD=60  # seconds
# Maximum slot index for --isolate (0 reserved for base stack; 1..N for isolated runs).
ISOLATE_MAX_SLOT=45

# _file_mtime <path> — epoch mtime of a path, or empty when it cannot be
# stat'ed (vanished concurrently, permissions). Callers must treat a
# non-numeric result as "unknown", never as zero.
_file_mtime() {
  if [[ "$OSTYPE" == darwin* ]]; then
    stat -f %m "$1" 2>/dev/null || true
  else
    stat -c %Y "$1" 2>/dev/null || true
  fi
}

# _kept_slot_age <slot> — age in seconds of a slot for the ISOLATE_KEEP_TTL
# comparison, or empty when no anchor can be stat'ed. The TTL anchor is the
# `pid` file's mtime: it is written ONCE at claim (~line 406) and never
# rewritten, so it is a stable claim-time stamp (and `pid.start` is a SIBLING
# file, so writing it never disturbs `pid`'s mtime). Mandatory fallback chain so
# a kept slot is never immortal even if `pid` is gone: pid-file mtime →
# `project`-file mtime → slot-dir mtime. If NONE of these can be stat'ed the
# caller falls back to the existing ISOLATE_STALE_THRESHOLD age path; without
# that fallback an unstattable anchor would skip the age comparison and the
# kept→stale transition would silently never fire.
_kept_slot_age() {
  local slot_entry="$ISOLATE_SLOT_DIR/${1:?slot required}"
  local anchor anchor_mtime
  for anchor in "$slot_entry/pid" "$slot_entry/project" "$slot_entry"; do
    anchor_mtime="$(_file_mtime "$anchor")"
    if [[ "$anchor_mtime" =~ ^[0-9]+$ ]]; then
      printf '%d\n' "$(( $(date +%s) - anchor_mtime ))"
      return 0
    fi
  done
  return 0
}

# _pid_start_time <pid> — the process start time of <pid> as an opaque,
# platform-native string, or empty when it cannot be read (no such pid, EPERM
# on a cross-user pid, or an unsupported platform). This is the anti-PID-reuse
# fingerprint: a recycled pid lands on a DIFFERENT process with a DIFFERENT
# start time, so a recorded-vs-current mismatch means the original owner is
# gone. The exact textual format is never interpreted — it only has to be
# stable for one process's lifetime and to DIFFER across a pid recycle, which
# both forms below satisfy. Written to a `pid.start` sibling of the slot's
# `pid` file at claim and re-read at verify; the SAME function produces both
# sides so the comparison can never drift across a format change.
#   macOS:  `ps -o lstart=` — the full "Wed Jun 26 11:33:20 2026" start stamp.
#   Linux:  field 22 of /proc/<pid>/stat — starttime in clock ticks since boot.
_pid_start_time() {
  local pid="${1:?pid required}"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  if [[ "$OSTYPE" == darwin* ]]; then
    # ps prints a fixed-format date; trim surrounding whitespace so a stray
    # leading/trailing space can never manufacture a spurious mismatch.
    local out
    out="$(ps -o lstart= -p "$pid" 2>/dev/null || true)"
    printf '%s' "$out" | awk '{$1=$1; print}'
  elif [ -r "/proc/$pid/stat" ]; then
    # /proc/<pid>/stat: comm (field 2) is parenthesized and may contain spaces;
    # split on the LAST ')' so the numeric fields after it line up regardless.
    local stat rest
    stat="$(cat "/proc/$pid/stat" 2>/dev/null || true)"
    [ -n "$stat" ] || return 0
    rest="${stat##*) }"
    # After comm+state, starttime is field 22 of the full line == field 20 of
    # `rest` (rest begins at field 3 = state). state ppid pgrp session tty_nr
    # tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime
    # priority nice num_threads itrealvalue starttime → 20th token.
    printf '%s' "$rest" | awk '{print $20}'
  fi
}

# Reap one stale slot: compose any docker remnants of the recorded project
# down (best-effort), then remove the slot's runs/<project> scratch dir AND
# the slot dir itself. Without the runs-dir removal, crashed runs leak orphan
# run dirs under XDG state forever (nothing else cleans them —
# restore_isolation only removes the CURRENT run's dir).
#
# Kept stacks: container-liveness protection applies only while containers
# are RUNNING (the sweep's probe is `docker ps -q`, deliberately — `-aq`
# would let crashed runs' exited containers protect dead slots forever). A
# --keep'd stack whose containers are stopped-but-present (manual `docker
# stop`, daemon restart, host reboot) therefore DOES reach this function:
# its owner pid is dead by design, so the slot is reclaimed. The compose-down
# below keeps that safe — stopped containers and named volumes are removed
# along with the state dirs instead of being stranded with no compose state.
#
# Order matters: runs/<project> FIRST, slot dir LAST. The slot's project
# record is the ONLY pointer to the runs dir — a crash between the two
# removals with the old order (slot first) orphaned the runs dir forever,
# while with this order a surviving slot record simply makes the next sweep
# retry the reap.
_reap_isolate_slot() {
  local slot_entry="${1:?slot entry required}"
  local slot_proj="${2:-}"
  if [ -n "$slot_proj" ]; then
    # The record comes from a user-writable state file — never interpolate it
    # into rm -rf unvalidated (a corrupted record like "../.." would traverse
    # out of the runs dir). Compose project names are [a-z0-9][a-z0-9_-]*; on
    # mismatch, warn and leave the SLOT intact too: the record is the ONLY
    # pointer to the runs dir (see the header above), so reaping the slot
    # anyway would orphan whatever runs dir the record actually points at.
    # A corrupted record is a bug or tampering — leave the evidence in place
    # for manual inspection rather than half-destroy it.
    #
    # Reserved name, same treatment: 'showcase' IS the default stack's compose
    # project name and PASSES the charset check below, so a record reading
    # 'showcase' (a corrupt record, or one written by an older CLI version
    # before apply_isolation reserved the name) would aim the compose-down at
    # the user's LIVE DEFAULT stack — and --volumes would destroy its
    # PocketBase data. apply_isolation refuses the name at claim time, but the
    # reaper must not trust records: warn and leave the whole slot intact for
    # manual inspection (no compose-down, no state removal).
    if [ "$slot_proj" = "showcase" ]; then
      warn "Slot record at $slot_entry names the RESERVED project 'showcase' — that is the LIVE default stack's compose project, so reaping it would compose the default stack down (--volumes included: PocketBase data destroyed). Leaving the slot intact for manual inspection; its runs dir would be $(_showcase_state_base)/runs/$slot_proj"
      return 0
    fi
    if [[ "$slot_proj" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
      # Best-effort remnant cleanup BEFORE deleting any state: a stopped kept
      # stack (see the header) still has containers + named volumes; deleting
      # the run dir + slot first would strand them with no compose state
      # (split-brain). `compose -p` resolves resources via project labels, so
      # no -f compose file is needed; failure (daemon down, nothing to remove)
      # is non-fatal — the rm below still reclaims the state dirs.
      docker compose -p "$slot_proj" down --remove-orphans --volumes >/dev/null 2>&1 || true
      # State-removal rms are guarded throughout this file: a concurrent
      # claimant/release can race the same path, and the loser's mid-traversal
      # ENOENT makes rm exit nonzero — which must not kill the CLI under
      # bin/showcase's `set -e` (the state is gone either way).
      rm -rf "$(_showcase_state_base)/runs/$slot_proj" 2>/dev/null || true
    else
      warn "Slot record at $slot_entry names suspicious project '$slot_proj' (path-traversal guard) — leaving the slot intact for manual inspection; its runs dir would be $(_showcase_state_base)/runs/$slot_proj"
      return 0
    fi
  fi
  rm -rf "$slot_entry" 2>/dev/null || true
}

# Release the sweep lock — but ONLY if it is still ours. The takeover path
# below can legitimately move an over-age lock out from under a slow-but-live
# holder and install a fresh lock of its own; if the original holder then
# blindly removed "$sweep_lock" on its way out, it would destroy the
# TAKEOVER's lock and open the door to a THIRD concurrent sweeper. Ownership
# is the pid file written into the lock dir at acquisition.
_release_sweep_lock() {
  local sweep_lock="${1:?sweep lock path required}"
  # Lock (or its pid ownership marker) gone entirely: nothing to release and
  # no holder to report — a takeover mv'd it away, or something external
  # cleaned it up. Distinct from the takeover case below, which has an actual
  # current holder's lock that must be left in place.
  if [ ! -d "$sweep_lock" ] || [ ! -f "$sweep_lock/pid" ]; then
    warn "Sweep lock $sweep_lock vanished while we held it (takeover or external cleanup) — leaving as-is"
    return 0
  fi
  local lock_pid
  lock_pid="$(cat "$sweep_lock/pid" 2>/dev/null || true)"
  if [ "$lock_pid" = "$$" ]; then
    rm -rf "$sweep_lock"
  else
    warn "Sweep lock $sweep_lock was taken over while we held it (current holder pid: ${lock_pid:-unknown}) — leaving it in place"
  fi
}

# Claim an isolation slot using atomic mkdir. Slots 1..ISOLATE_MAX_SLOT are
# usable for --isolate runs; slot 0 is reserved for the base (non-isolate)
# stack. Each slot dir contains a "pid" file for stale-detection. The port
# offset is (slot + 1) * 200, so slot 1 → +400, slot 2 → +600, etc. If
# SHOWCASE_ISO_SLOT is set, the picker pins to that slot; otherwise it
# auto-picks the first free slot in 1..ISOLATE_MAX_SLOT.
_claim_isolate_slot() {
  mkdir -p "$ISOLATE_SLOT_DIR"

  # Reclaim crashed-takeover tombstones: a sweeper that died between the
  # takeover mv and its rm -rf (below) leaves .sweep.lock.tomb.<pid> behind
  # forever — dot-named, so neither the sweep glob nor the claim loop ever
  # sees it, and nothing else cleans it. Age them by the LOCK threshold: a
  # fresh tombstone may belong to a takeover in flight (mv done, rm pending),
  # so only over-age ones are removed.
  local tomb
  for tomb in "$ISOLATE_SLOT_DIR"/.sweep.lock.tomb.*; do
    [ -e "$tomb" ] || continue
    local tomb_mtime
    tomb_mtime="$(_file_mtime "$tomb")"
    [[ "$tomb_mtime" =~ ^[0-9]+$ ]] || continue
    if [ $(( $(date +%s) - tomb_mtime )) -gt "$ISOLATE_SWEEP_LOCK_STALE_THRESHOLD" ]; then
      # This cleanup runs OUTSIDE the sweep lock by design: two claimants can
      # both observe the same over-age tombstone and race the removal, and the
      # loser's mid-traversal ENOENT makes rm exit nonzero — which must not
      # kill the CLI under `set -e` (losing the race is fine; the tombstone is
      # gone either way).
      rm -rf "$tomb" 2>/dev/null || true
    fi
  done

  # Serialize the stale sweep with a lock dir. Without it, two concurrent
  # claimants can both observe slot N stale: A reaps + re-claims it (writing a
  # live pid), then B reaps A's FRESH claim based on its stale observation and
  # claims the same slot — two owners, identical port offsets. The lock is
  # advisory and non-blocking: if another process holds it, we SKIP the sweep
  # entirely (that process is already sweeping) and go straight to the claim
  # loop. The dot-name keeps the lock out of the sweep's [0-9]* glob and the
  # claim loop's numeric slot names.
  local sweep_lock="$ISOLATE_SLOT_DIR/.sweep.lock"
  local have_sweep_lock=false
  if mkdir "$sweep_lock" 2>/dev/null; then
    echo "$$" > "$sweep_lock/pid"   # ownership marker for _release_sweep_lock
    have_sweep_lock=true
  else
    # Lock held — but a sweeper that crashed mid-sweep would leave it behind
    # forever, permanently disabling stale reaping. Take over an over-age lock
    # (dedicated short threshold: the lock is held for seconds, not hours);
    # otherwise (fresh lock, or lock vanished between our mkdir and the stat)
    # skip the sweep this round. A LIVE sweeper refreshes the lock mtime every
    # slot iteration (heartbeat in _sweep_isolate_slots), so an over-age lock
    # really does mean a crashed/wedged holder.
    local lock_mtime
    lock_mtime="$(_file_mtime "$sweep_lock")"
    if [[ "$lock_mtime" =~ ^[0-9]+$ ]] \
      && [ $(( $(date +%s) - lock_mtime )) -gt "$ISOLATE_SWEEP_LOCK_STALE_THRESHOLD" ]; then
      # Atomic takeover: rename the stale lock aside to a unique tombstone
      # first. Two claimants can BOTH observe the lock over-age; with a plain
      # rm+mkdir the slower one could rm the faster one's FRESH replacement
      # lock and retake it — two concurrent sweepers. rename(2) is atomic:
      # exactly one mv wins, the loser's mv fails and it simply skips the
      # sweep this round (it must NOT remove a lock the winner may already
      # have refreshed). The winner disposes of the tombstone and takes a
      # brand-new lock. A crash between mv and rm leaves only a dot-named
      # tombstone, invisible to both the sweep glob and the claim loop —
      # reclaimed once over-age by the tombstone cleanup at the top of this
      # function.
      local lock_tombstone="$ISOLATE_SLOT_DIR/.sweep.lock.tomb.$$"
      if mv "$sweep_lock" "$lock_tombstone" 2>/dev/null; then
        warn "Removing stale sweep lock (crashed sweeper?): $sweep_lock"
        # Guarded: mv preserves the lock's (already over-age) mtime, so this
        # fresh tombstone is immediately over-age too — concurrent claimants'
        # tombstone-reclamation loops (top of this function) legitimately race
        # this removal, and the loser's nonzero rm must not kill the CLI.
        rm -rf "$lock_tombstone" 2>/dev/null || true
        if mkdir "$sweep_lock" 2>/dev/null; then
          echo "$$" > "$sweep_lock/pid"   # ownership marker for _release_sweep_lock
          have_sweep_lock=true
        fi
      fi
    fi
  fi

  if [ "$have_sweep_lock" = true ]; then
    _sweep_isolate_slots
    _release_sweep_lock "$sweep_lock"
  fi

  if [ -n "${SHOWCASE_ISO_SLOT:-}" ]; then
    # Pinned path
    local pinned="$SHOWCASE_ISO_SLOT"
    [[ "$pinned" =~ ^[0-9]+$ ]] || die "SHOWCASE_ISO_SLOT must be a positive integer, got: $pinned"
    [ "$pinned" -ge 1 ] || die "slot 0 is reserved for the base stack — use 1-$ISOLATE_MAX_SLOT"
    [ "$pinned" -le "$ISOLATE_MAX_SLOT" ] || die "SHOWCASE_ISO_SLOT=$pinned exceeds ISOLATE_MAX_SLOT=$ISOLATE_MAX_SLOT"

    local slot_dir="$ISOLATE_SLOT_DIR/$pinned"
    if mkdir "$slot_dir" 2>/dev/null; then
      :   # fresh claim, fall through to port probe
    else
      # EEXIST: consult liveness
      local liveness
      liveness=$(_slot_liveness "$pinned")
      if [ "$liveness" = "live" ]; then
        # Identify the live axis for the message
        local axis="containers/pid"
        die "Slot $pinned is already in use (liveness=$liveness, $axis) — pick a different SHOWCASE_ISO_SLOT or clear it first"
      fi
      # stale or inconclusive: reap and retry once
      local pinned_entry="$ISOLATE_SLOT_DIR/$pinned"
      local pinned_proj
      pinned_proj="$(cat "$pinned_entry/project" 2>/dev/null || true)"
      _reap_isolate_slot "$pinned_entry" "$pinned_proj" || true
      mkdir "$slot_dir" 2>/dev/null || die "Slot $pinned could not be reclaimed after reap — check $slot_dir manually"
    fi
    # Port-probe
    if ! _slot_ports_free "$pinned"; then
      rmdir "$slot_dir" 2>/dev/null || true
      die "Slot $pinned ports are held by a foreign process — see info messages above; clear conflicts or pick a different SHOWCASE_ISO_SLOT"
    fi
    ISOLATE_SLOT="$pinned"
  else
    # Auto-pick path: loop 1..ISOLATE_MAX_SLOT (slot 0 reserved)
    local n=1
    while [ "$n" -le "$ISOLATE_MAX_SLOT" ]; do
      local slot_dir="$ISOLATE_SLOT_DIR/$n"
      if mkdir "$slot_dir" 2>/dev/null; then
        if _slot_ports_free "$n"; then
          ISOLATE_SLOT="$n"
          break
        else
          rmdir "$slot_dir" 2>/dev/null || true
          info "Slot $n ports held, trying next"
          # Benign race: between our rmdir and the next iteration's mkdir attempt, a concurrent
          # claimant can mkdir this same slot dir. That's fine — mkdir is the
          # atomic synchronization point, so only one process can hold a given
          # slot at a time. The concurrent claimant wins; we advance to n+1 and
          # no double-claim occurs. Port-probe and ownership-write (pid file) are
          # also per-slot, so there is no cross-claimant corruption under load.
        fi
      fi
      n=$((n + 1))
    done
    [ -n "${ISOLATE_SLOT:-}" ] || die "No isolation slots available (1-$ISOLATE_MAX_SLOT exhausted)"
  fi

  # Common post-claim. Write order is load-bearing: `pid` FIRST (preserving the
  # "pid written before the project record" invariant the liveness classifier
  # relies on — a missing pid file with a recorded project means the owner is
  # genuinely gone), THEN `pid.start`. `pid.start` is the anti-reuse
  # fingerprint: the owning process's start time, re-read and compared at
  # liveness time so a recycled pid (same number, different process, different
  # start time) reads as "owner gone" rather than spuriously alive. It is a
  # SIBLING file, written AFTER pid, so it never perturbs the `pid` file's own
  # mtime (which the kept-slot TTL anchor depends on). A crash between the two
  # writes leaves `pid` but no `pid.start` → owner "unverifiable" → treated as
  # dead, which is the safe direction.
  echo "$$" > "$ISOLATE_SLOT_DIR/$ISOLATE_SLOT/pid"
  _pid_start_time "$$" > "$ISOLATE_SLOT_DIR/$ISOLATE_SLOT/pid.start"
  ISOLATE_PORT_OFFSET=$(( (ISOLATE_SLOT + 1) * 200 ))
  return 0
}

# _owner_liveness <slot> — classify the slot's OWNING PROCESS, independent of
# any container state. Prints exactly one word and exits 0:
#   alive        — pid file present + numeric + kill -0 succeeds AND the pid's
#                  current start time matches the recorded pid.start.
#   reused       — kill -0 succeeds but the current start time DIFFERS from the
#                  recorded pid.start: the pid was recycled to a NEW process,
#                  so the original owner is gone.
#   dead         — pid file present + numeric but kill -0 fails (ESRCH, or
#                  EPERM on a cross-user pid — both read as "not our owner",
#                  matching the single-user model documented at the top of
#                  this file; we do NOT parse kill -0 stderr, which is
#                  locale/platform fragile).
#   unverifiable — pid file present + numeric + alive, but no readable
#                  pid.start to verify against (legacy slot written before the
#                  pid.start invariant, a crash between the pid and pid.start
#                  writes, or a platform that cannot read process start times).
#                  Treated as "owner gone" by every caller — REMOVES the old
#                  bare-kill-0 reuse hole at the cost of demoting a legacy
#                  live-owner slot to kept (TTL-reaped) instead of protected.
#   absent       — no pid file, or its contents are empty/non-numeric
#                  (inconclusive: a truncated pid write, or a project-less
#                  legacy slot). Distinct from `dead`: callers route this to
#                  the age fallback, never to an immediate PID-driven reap.
#
# This is the SINGLE source of truth for owner liveness, shared by
# _slot_liveness (the live|kept|stale classifier) and _slot_state (the table's
# PID annotation) so the two can never diverge.
_owner_liveness() {
  local slot="${1:?slot required}"
  local slot_entry="$ISOLATE_SLOT_DIR/$slot"
  local slot_pid_file="$slot_entry/pid"
  local slot_pid=""
  if [ -f "$slot_pid_file" ]; then
    slot_pid="$(cat "$slot_pid_file" 2>/dev/null || true)"
  fi
  if ! [[ "$slot_pid" =~ ^[0-9]+$ ]]; then
    printf 'absent\n'
    return 0
  fi
  # kill -0 failure (ESRCH or EPERM) → the pid is not a process we own → dead.
  if ! kill -0 "$slot_pid" 2>/dev/null; then
    printf 'dead\n'
    return 0
  fi
  # Pid is alive — but is it the SAME process we recorded? Verify start time.
  local recorded_start=""
  if [ -f "$slot_entry/pid.start" ]; then
    recorded_start="$(cat "$slot_entry/pid.start" 2>/dev/null || true)"
  fi
  if [ -z "$recorded_start" ]; then
    # No fingerprint to verify against — cannot prove this is our owner.
    printf 'unverifiable\n'
    return 0
  fi
  local current_start
  current_start="$(_pid_start_time "$slot_pid")"
  if [ -z "$current_start" ]; then
    # Pid is alive (kill -0 ok) but its start time is unreadable (e.g. EPERM on
    # a cross-user pid) — cannot confirm identity → treat as unverifiable.
    printf 'unverifiable\n'
    return 0
  fi
  if [ "$current_start" = "$recorded_start" ]; then
    printf 'alive\n'
  else
    printf 'reused\n'
  fi
  return 0
}

# Classify a single isolation slot as live | kept | stale | inconclusive —
# pure classification, no reaping, no info logging. Shared between
# _sweep_isolate_slots (which reaps stale slots) and the picker (which avoids
# binding to live slots). Always prints exactly one word to stdout and exits 0.
#
# Governing rule: when a slot has RUNNING containers, the container check wins
# → the slot is `kept` or `live`, NEVER reaped solely on an owner-PID result.
# Owner liveness only UPGRADES a running-container slot from TTL-bounded `kept`
# to indefinitely-protected `live`; it can never by itself make a
# running-container slot eligible for immediate reaping.
#
# Signals (in order):
#   1. Compose-project containers first. Docker-ps failure → inconclusive
#      (warn and leave it alone, unchanged). If containers ARE running, branch
#      on owner liveness:
#        - owner alive (start-time-verified)            → live
#        - owner dead / reused / unverifiable / absent  → kept: owning
#          process gone (or unprovable) but the project still has running
#          containers. NOT live, NOT immediately stale. The kept-slot TTL
#          (below) governs the kept→stale transition: a `kept` slot is left
#          alone until it outlives ISOLATE_KEEP_TTL, then ages out to stale.
#   2. No running containers (or none recorded). The owner PID is authoritative
#      for "in active use":
#        - owner alive (start-time-verified)            → live (e.g. mid-build
#          before any container exists)
#        - owner dead OR reused                         → stale
#   3. Project recorded + no pid file (owner absent) + no running containers
#      → stale (claim writes the pid file BEFORE the project record, so a
#      missing pid means the owner state is genuinely gone). Unchanged.
#   4. Age fallback — owner absent/unverifiable (missing/empty/non-numeric pid,
#      or a live-but-unverifiable owner on a project-less legacy slot) AND age
#      > ISOLATE_STALE_THRESHOLD → stale. Unchanged.
#   5. Otherwise → inconclusive.
_slot_liveness() {
  local slot="${1:?slot required}"
  local slot_entry="$ISOLATE_SLOT_DIR/$slot"
  if [ ! -d "$slot_entry" ]; then
    printf 'inconclusive\n'
    return 0
  fi
  local owner
  owner="$(_owner_liveness "$slot")"
  local slot_proj has_proj=false
  slot_proj="$(cat "$slot_entry/project" 2>/dev/null || true)"
  if [ -n "$slot_proj" ]; then
    has_proj=true
    local live_containers
    if ! live_containers="$(docker ps -q --filter "label=com.docker.compose.project=$slot_proj" 2>/dev/null)"; then
      warn "Cannot verify liveness of slot $slot (docker ps failed) — leaving it alone"
      printf 'inconclusive\n'
      return 0
    fi
    if [ -n "$live_containers" ]; then
      # Running containers → the container check wins. A live, start-time-
      # verified owner protects the slot indefinitely (`live`); any other
      # owner state (dead/reused/unverifiable/absent) means the owning process
      # is gone or unprovable while containers still run → `kept`.
      if [ "$owner" = "alive" ]; then
        printf 'live\n'
        return 0
      fi
      # ── TTL on running kept stacks ────────────────────────────────────────
      # The owner is gone/unprovable while containers still run → `kept`. A
      # `kept` stack is protected only until it outlives ISOLATE_KEEP_TTL: a
      # forgotten `--keep` must not accumulate indefinitely. Age anchors on the
      # `pid`-file mtime (stable claim-time stamp), with the mandatory fallback
      # chain in _kept_slot_age (pid → project → slot-dir mtime → the existing
      # ISOLATE_STALE_THRESHOLD path) so a kept slot is never immortal.
      local kept_age
      kept_age="$(_kept_slot_age "$slot")"
      if [[ "$kept_age" =~ ^[0-9]+$ ]]; then
        if [ "$kept_age" -gt "$ISOLATE_KEEP_TTL" ]; then
          printf 'stale\n'
          return 0
        fi
        printf 'kept\n'
        return 0
      fi
      # No anchor was stat'able: fall back to the slot-age / ISOLATE_STALE_
      # THRESHOLD path below so an unanchored kept slot still ages out to stale
      # rather than living forever.
      local fallback_mtime
      fallback_mtime="$(_file_mtime "$slot_entry")"
      if [[ "$fallback_mtime" =~ ^[0-9]+$ ]]; then
        local fallback_age
        fallback_age=$(( $(date +%s) - fallback_mtime ))
        if [ "$fallback_age" -gt "$ISOLATE_STALE_THRESHOLD" ]; then
          printf 'stale\n'
          return 0
        fi
      fi
      printf 'kept\n'
      return 0
    fi
  fi
  # No running containers (or none recorded): the owner PID is authoritative.
  if [ "$owner" = "alive" ]; then
    printf 'live\n'
    return 0
  fi
  # A numeric owner pid that is dead, reused, or alive-but-unverifiable is
  # authoritative proof the original owner is gone (no containers to defer to)
  # → stale. `absent` (no numeric pid at all) is NOT proof — it routes to the
  # project / age fallbacks below.
  if [ "$owner" = "dead" ] || [ "$owner" = "reused" ] || [ "$owner" = "unverifiable" ]; then
    printf 'stale\n'
    return 0
  fi
  # owner is `absent` from here on (no pid file, or empty/non-numeric contents).
  if [ "$has_proj" = true ] && [ ! -f "$slot_entry/pid" ]; then
    # Project recorded, no live containers, and no pid file AT ALL — the claim
    # writes the pid file BEFORE the project record, so a missing pid means the
    # owner state is genuinely gone → stale. A present-but-empty/non-numeric
    # pid file is NOT this case: it may be a live owner mid-build whose pid
    # write was truncated, so it defers to the age fallback below.
    printf 'stale\n'
    return 0
  fi
  local slot_mtime
  slot_mtime="$(_file_mtime "$slot_entry")"
  if [[ "$slot_mtime" =~ ^[0-9]+$ ]]; then
    local slot_age
    slot_age=$(( $(date +%s) - slot_mtime ))
    if [ "$slot_age" -gt "$ISOLATE_STALE_THRESHOLD" ]; then
      printf 'stale\n'
      return 0
    fi
  fi
  printf 'inconclusive\n'
  return 0
}

# Sweep stale slots. Caller (_claim_isolate_slot) MUST hold .sweep.lock.
_sweep_isolate_slots() {
  # Staleness signals, in order:
  #   1. Compose-project liveness: RUNNING containers always protect the slot
  #      (this is what keeps a --keep'd stack — owning process gone, containers
  #      still up — from being stolen). RUNNING only, deliberately (`docker ps
  #      -q`, not `-aq`): exited containers from crashed runs must not protect
  #      dead slots forever, so a kept stack whose containers were STOPPED
  #      (docker stop, daemon restart, reboot) is reclaimed — with its
  #      remnants composed down by _reap_isolate_slot. A docker failure is NOT
  #      "no containers": if we cannot ask, we leave the slot alone.
  #   2. Owning-PID liveness: a live owning PID always protects the slot. This
  #      matters because apply_isolation records the project BEFORE any
  #      container starts (image builds can take minutes), so "project recorded
  #      + zero containers" alone is NOT proof of staleness.
  #   3. Age: fallback when the pid check is inconclusive — the pid file is
  #      missing on a slot with no recorded project (legacy slots predating
  #      the "project" file), or the pid file EXISTS but its contents are
  #      empty/non-numeric on ANY slot (possibly a live owner whose pid write
  #      was truncated — inconclusive, so it defers to the age fallback
  #      rather than being reaped immediately; once the slot is older than
  #      ISOLATE_STALE_THRESHOLD it IS reaped, inconclusive pid and all,
  #      so such slots don't leak forever). A project-recorded slot
  #      with NO pid file at all is reaped directly: the claim writes the pid
  #      file before the project record, so its absence means the owner state
  #      is genuinely gone.
  local sweep_lock="$ISOLATE_SLOT_DIR/.sweep.lock"
  local slot_entry
  for slot_entry in "$ISOLATE_SLOT_DIR"/[0-9]*; do
    [ -d "$slot_entry" ] || continue
    # Heartbeat: refresh the lock mtime at the top of every iteration so a
    # LIVE sweep never looks over-age to a concurrent claimant. A full sweep
    # makes up to 46 `docker ps` calls; a wedged daemon can stretch that past
    # ISOLATE_SWEEP_LOCK_STALE_THRESHOLD, and without the heartbeat the
    # claimant would "take over" the lock from a sweeper that is still
    # running. Refresh-only, NEVER create: -c behind the -d guard. A bare
    # `touch` here used to RECREATE the lock as a plain FILE when a takeover
    # mv'd the dir away mid-iteration — the takeover's mkdir then failed
    # against the file and sweeping wedged until the 60s over-age self-heal.
    # Failure/vanished lock is non-fatal (_release_sweep_lock handles the
    # taken-over/vanished cases on the way out).
    [ -d "$sweep_lock" ] && touch -c "$sweep_lock" 2>/dev/null || true
    local slot_name
    slot_name="$(basename "$slot_entry")"
    local liveness
    liveness="$(_slot_liveness "$slot_name")"
    if [ "$liveness" = "live" ] || [ "$liveness" = "kept" ] || [ "$liveness" = "inconclusive" ]; then
      # `live` → in active use (running containers + live verified owner, or a
      # live verified owner mid-build). `kept` → running containers whose owner
      # is gone/unprovable — a --keep'd stack — protected until it outlives
      # ISOLATE_KEEP_TTL, at which point _slot_liveness returns `stale` and the
      # reap path below (with the loud kept-past-TTL warning) fires.
      # `inconclusive` → docker-ps failure (already warned by _slot_liveness),
      # or a slot dir that vanished mid-check, or a fresh-but-not-yet-aged slot
      # whose pid write hasn't landed. Either way: leave it alone.
      continue
    fi
    # Stale. Re-derive the evidence to emit the exact reason in the info line
    # before reaping. The reads here mirror _slot_liveness — kept in the
    # sweeper so the helper stays purely classifying.
    local slot_proj has_proj=false
    slot_proj="$(cat "$slot_entry/project" 2>/dev/null || true)"
    [ -n "$slot_proj" ] && has_proj=true
    local slot_pid_file="$slot_entry/pid"
    local slot_pid="" pid_file_present=false
    if [ -f "$slot_pid_file" ]; then
      pid_file_present=true
      slot_pid="$(cat "$slot_pid_file" 2>/dev/null || true)"
    fi
    if [[ "$slot_pid" =~ ^[0-9]+$ ]]; then
      # The classifier called this stale with a numeric pid: the owner is dead,
      # the pid was reused, or it is alive-but-unverifiable (no pid.start). Name
      # the shared owner verdict so the reason matches the classifier exactly.
      local owner_verdict
      owner_verdict="$(_owner_liveness "$slot_name")"
      # Distinguish a kept stack reaped PAST its TTL: a recorded project whose
      # containers are STILL RUNNING, yet liveness came back `stale` — the only
      # way that happens for a numeric-pid slot is the ISOLATE_KEEP_TTL
      # transition (a forgotten `--keep` leak). Emit a LOUD warning naming
      # project / age / TTL so the leak is visible, not a quiet info line.
      if [ "$has_proj" = true ]; then
        local running_containers=""
        running_containers="$(docker ps -q --filter "label=com.docker.compose.project=$slot_proj" 2>/dev/null || true)"
        if [ -n "$running_containers" ]; then
          local kept_age
          kept_age="$(_kept_slot_age "$slot_name")"
          [[ "$kept_age" =~ ^[0-9]+$ ]] || kept_age="?"
          warn "reaping kept stack '$slot_proj' (slot $slot_name): owner PID $slot_pid $owner_verdict, containers still running, age ${kept_age}s > keep TTL ${ISOLATE_KEEP_TTL}s — forgotten --keep leak"
          _reap_isolate_slot "$slot_entry" "$slot_proj"
          continue
        fi
      fi
      info "Attempting to reclaim stale slot $slot_name (PID $slot_pid owner $owner_verdict)"
      _reap_isolate_slot "$slot_entry" "$slot_proj"
      continue
    fi
    if [ "$has_proj" = true ] && [ "$pid_file_present" = false ]; then
      # Project recorded, no live containers, and no pid file at all — the
      # claim writes the pid file BEFORE the project record, so a missing pid
      # file means the owner state is genuinely gone. A pid file that EXISTS
      # but is empty/non-numeric is NOT the same thing: it may be a live owner
      # mid-build whose pid write was truncated — that case is INCONCLUSIVE
      # and falls through to the age fallback below instead of being reaped.
      info "Attempting to reclaim stale slot $slot_name (project $slot_proj has no live containers and no recorded owner)"
      _reap_isolate_slot "$slot_entry" "$slot_proj"
      continue
    fi
    # Fallback: age-based cleanup when the pid check is inconclusive (pid file
    # missing on a project-less legacy slot, or present-but-empty/non-numeric
    # contents on any slot). Capture the mtime with a
    # failure guard: a concurrent release can rm -rf the slot between our glob
    # and this stat, and an empty substitution inside $(( )) is a syntax error
    # that would kill the whole CLI under `set -e`. A vanished slot needs no
    # reaping — skip it.
    local slot_mtime
    slot_mtime="$(_file_mtime "$slot_entry")"
    [[ "$slot_mtime" =~ ^[0-9]+$ ]] || continue
    local slot_age
    slot_age=$(( $(date +%s) - slot_mtime ))
    if [ "$slot_age" -gt "$ISOLATE_STALE_THRESHOLD" ]; then
      # Surface WHY the pid check was inconclusive — it's the evidence that
      # routed this slot to the age fallback in the first place.
      local pid_evidence="no pid file"
      if [ "$pid_file_present" = true ]; then
        pid_evidence="pid file present but empty/non-numeric"
      fi
      info "Attempting to reclaim stale slot $slot_name (age ${slot_age}s > ${ISOLATE_STALE_THRESHOLD}s; owner-pid check inconclusive: $pid_evidence)"
      _reap_isolate_slot "$slot_entry" "$slot_proj"
    fi
  done
}

# Release the claimed isolation slot. The parent slots dir is deliberately
# LEFT IN PLACE: removing it here raced a concurrent claimer between its
# `mkdir -p` of the parent and its per-slot mkdir — every slot mkdir then
# failed ENOENT and the claimer died "No isolation slots available". An empty
# slots dir under XDG state is harmless.
_release_isolate_slot() {
  if [ -n "$ISOLATE_SLOT" ] && [ -d "$ISOLATE_SLOT_DIR/$ISOLATE_SLOT" ]; then
    rm -rf "$ISOLATE_SLOT_DIR/$ISOLATE_SLOT" 2>/dev/null || true
  fi
  ISOLATE_SLOT=""
}

# Print every host port that the given isolation slot will bind, one per line.
# Includes all slug ports from PORTS_FILE and the four infra base ports.
# Each output port = base + (slot+1)*200.
_slot_offset_ports() {
  local slot="${1:?slot required}"

  # Validate: must be a non-negative integer
  if ! printf '%s' "$slot" | grep -qE '^[0-9]+$'; then
    die "_slot_offset_ports: slot must be a non-negative integer, got: $slot"
  fi
  if [ "$slot" -gt "$ISOLATE_MAX_SLOT" ]; then
    die "_slot_offset_ports: slot $slot exceeds ISOLATE_MAX_SLOT ($ISOLATE_MAX_SLOT)"
  fi

  local offset=$(( (slot + 1) * 200 ))
  local infra_ports=(4010 8090 3210 8081)

  # Slug ports from PORTS_FILE
  local port_values
  if command -v jq &>/dev/null; then
    port_values="$(jq -r 'to_entries[] | .value' "$PORTS_FILE" 2>/dev/null)"
  else
    port_values="$(grep -o '"[^"]*"[[:space:]]*:[[:space:]]*[0-9]*' "$PORTS_FILE" | sed 's/.*:[[:space:]]*//')"
  fi

  while IFS= read -r base; do
    [ -z "$base" ] && continue
    printf '%d\n' $(( base + offset ))
  done <<< "$port_values"

  # Infra ports
  for base in "${infra_ports[@]}"; do
    printf '%d\n' $(( base + offset ))
  done
}

# _slot_ports_free <slot> [precomputed_liveness] — probe every port the slot
# would bind for non-self listeners. Returns 0 if all ports are free (or only
# held by this slot's own compose project), 1 if any port is held by a foreign
# process. Emits one `info` line per held port. Requires lsof (matches
# cmd-doctor.sh convention).
#
# A caller that has ALREADY computed the slot's liveness (e.g. _slot_state,
# which probes it once and reuses the value) may pass it as the second arg to
# avoid a redundant docker-ps round-trip; an empty/absent second arg falls back
# to a lazy on-demand probe.
_slot_ports_free() {
  local slot="${1:?slot required}"
  local precomputed_liveness="${2:-}"
  if ! command -v lsof &>/dev/null; then
    die "--isolate requires lsof; install it"
  fi

  local slot_proj=""
  local slot_proj_file="$ISOLATE_SLOT_DIR/$slot/project"
  if [ -f "$slot_proj_file" ]; then
    slot_proj="$(cat "$slot_proj_file" 2>/dev/null || true)"
  fi

  # Honor a non-empty precomputed value so liveness is probed at most once per
  # slot; otherwise leave empty and lazily probe on first need below.
  local liveness="$precomputed_liveness"
  local any_held=0
  local port

  # Capture the slot's port list BEFORE the loop so _slot_offset_ports's exit
  # status reaches us. Consuming it inline via `done < <(_slot_offset_ports ...)`
  # ran _slot_offset_ports in a process-substitution SUBSHELL: a `die` on a bad
  # slot (out-of-range / non-numeric) exited only that subshell, the loop read
  # zero ports, any_held stayed 0, and we returned 0 ("all free") — silently
  # defeating the port-conflict guard for a bad slot. With command substitution
  # the die propagates the failing exit status; `|| die` re-raises it loudly so
  # both claim paths see an error, never a false "free".
  local ports
  ports="$(_slot_offset_ports "$slot")" \
    || die "_slot_ports_free: could not enumerate ports for slot $slot"

  while IFS= read -r port; do
    [ -z "$port" ] && continue
    local listeners
    listeners="$(lsof -i :"$port" -sTCP:LISTEN -P -n 2>/dev/null | tail -n +2 || true)"
    [ -z "$listeners" ] && continue

    local line
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local proc_name
      proc_name="$(printf '%s\n' "$line" | awk '{print $1}')"
      # Own-project filter: a docker/com.docker listener on a slot whose own
      # compose project is recorded and either `live` (live verified owner) OR
      # `kept` (running containers, owner gone/unprovable — a --keep'd stack) is
      # the slot's OWN binding, not a foreign hold. `kept` MUST be accepted here
      # too: with the new vocabulary a kept stack returns `kept`, and without
      # this a subsequent pinned/auto claim onto it would see its own
      # containers' ports as foreign and die "ports are held by a foreign
      # process".
      #
      # The `com\.docke` alternative matches macOS lsof's 9-char COMMAND
      # truncation of `com.docker.vmnetd`/`com.docker.backend` to `com.docke`
      # (the full names never fit the column) — without it the own-project
      # filter silently never fired on macOS and a kept stack's own published
      # port read as a foreign hold. `Python`/other names still do not match.
      if printf '%s' "$proc_name" | grep -qiE 'docker|com\.docke'; then
        if [ -n "$slot_proj" ]; then
          if [ -z "$liveness" ]; then
            liveness="$(_slot_liveness "$slot")"
          fi
          if [ "$liveness" = "live" ] || [ "$liveness" = "kept" ]; then
            continue
          fi
        fi
      fi
      info "Slot $slot port $port held by $proc_name"
      any_held=1
    done <<< "$listeners"
  done <<< "$ports"

  if [ "$any_held" -eq 0 ]; then
    return 0
  fi
  return 1
}

# _slot_state <slot> — emit one pipe-delimited line describing the slot:
#   slot|dir|pid|liveness|ports|offset|project
# Always exits 0. For an absent slot dir, ports is "-" (no probe) to keep the
# `bin/showcase slots` table tidy.
_slot_state() {
  local slot="${1:?slot required}"
  local slot_entry="$ISOLATE_SLOT_DIR/$slot"

  local dir="absent"
  [ -d "$slot_entry" ] && dir="present"

  # PID annotation derived from the SHARED _owner_liveness helper so the
  # table's render can never diverge from the classifier's verdict. The four
  # owner outputs map to exactly three render tokens:
  #   alive                  → <pid>          (start-time-verified our owner)
  #   reused                 → <pid>(reused)  (start-time mismatch — recycled)
  #   dead | unverifiable    → <pid>(dead)    (ESRCH/EPERM, or no pid.start)
  # `absent` (no numeric pid) keeps the bare "-". A `(dead)` annotation can
  # accompany EITHER LIVE=kept (dead owner + running containers) or LIVE=stale
  # (dead owner + no containers).
  local pid="-"
  if [ -f "$slot_entry/pid" ]; then
    local raw_pid
    raw_pid="$(cat "$slot_entry/pid" 2>/dev/null || true)"
    if [[ "$raw_pid" =~ ^[0-9]+$ ]]; then
      local owner
      owner="$(_owner_liveness "$slot")"
      case "$owner" in
        alive)            pid="$raw_pid" ;;
        reused)           pid="${raw_pid}(reused)" ;;
        dead|unverifiable) pid="${raw_pid}(dead)" ;;
        *)                pid="$raw_pid" ;;
      esac
    fi
  fi

  local project="-"
  if [ -f "$slot_entry/project" ]; then
    local raw_proj
    raw_proj="$(cat "$slot_entry/project" 2>/dev/null || true)"
    if [ -n "$raw_proj" ]; then
      project="$raw_proj"
    fi
  fi

  # Probe liveness ONCE, BEFORE the port probe, and thread the value into
  # _slot_ports_free so the own-project filter sees the same verdict without a
  # second docker-ps round-trip.
  local liveness
  liveness="$(_slot_liveness "$slot")"

  local ports="-"
  if [ "$dir" = "present" ]; then
    if ! command -v lsof >/dev/null 2>&1; then
      ports="?"
    elif _slot_ports_free "$slot" "$liveness" >/dev/null 2>&1; then
      ports="free"
    else
      ports="held"
    fi
  fi

  local offset
  if [ "$slot" = "0" ]; then
    offset=0
  else
    offset=$(( (slot + 1) * 200 ))
  fi

  printf '%s|%s|%s|%s|%s|%s|%s\n' \
    "$slot" "$dir" "$pid" "$liveness" "$ports" "$offset" "$project"
  return 0
}

# Contract: callers MUST arm `trap restore_isolation EXIT` BEFORE calling this
# function (cmd-test.sh does). Every die() below — invalid name, slot
# exhaustion, duplicate-name conflict, rewriter failure — relies on that trap
# for cleanup of the claimed slot (and, once created, the runs/<name> dir).
apply_isolation() {
  local name="${1:-}"
  # Slug the run is scoped to (from `showcase test <slug>`). Used below to
  # override the persistent stack's hardcoded LOCAL_SERVICES_JSON — that value
  # points at langgraph-python's agentic-chat cell for fast N=1 local demos, so
  # an iso stack for a DIFFERENT slug would inherit the wrong roster and the
  # harness's railway-services local-injection seam would enumerate the wrong
  # service (discovery.railway-services.local-injection count:1 names:["showcase-langgraph-python"]).
  local slug="${2:-}"
  # NB: ISOLATE_ACTIVE is deliberately NOT set here. cmd-test.sh arms
  # `trap restore_isolation EXIT` BEFORE calling this function, so if we
  # flipped it true before COMPOSE_CMD is repointed at the isolated project,
  # any die() below (invalid name, slot exhaustion) would make the trap run
  # `$COMPOSE_CMD down` against the ORIGINAL compose file — silently tearing
  # down the user's live DEFAULT stack. It is set only after the repoint.

  # docker compose project names must start with a lowercase letter or digit,
  # followed by lowercase letters, digits, '-' or '_' ([a-z0-9][a-z0-9_-]*).
  # Reject (or normalize) anything else so the user gets a clear error instead
  # of an opaque compose failure. We normalize-with-warn for ergonomic CLI use.
  if [ -n "$name" ] && ! [[ "$name" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    local lowered
    lowered="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
    if [[ "$lowered" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
      warn "Isolation name '$name' has uppercase chars; lowercasing to '$lowered' (docker compose project-name constraint)"
      name="$lowered"
    else
      die "Invalid --isolate name '$name': must start with a lowercase letter or digit, then lowercase letters, digits, '-' or '_' (docker compose project-name constraint)"
    fi
  fi

  # Reserved name: 'showcase' IS the default stack's compose project name
  # (docker compose defaults the project name to the directory name). It
  # passes the charset check, the container-name rewrite showcase- →
  # showcase- is a no-op, and the idempotent pre-down below would then run
  # `--project-name showcase down --remove-orphans --volumes` against the
  # user's LIVE DEFAULT stack — bypassing every other guard in this file.
  # Checked AFTER the lowercase normalization (so 'Showcase' is caught too)
  # and BEFORE any compose command or state write.
  if [ "$name" = "showcase" ]; then
    die "Isolation name 'showcase' is reserved: it collides with the default stack's compose project name (compose defaults the project to the directory name), so --isolate showcase would tear down the live default stack — pick another name"
  fi

  # Guard: clean up stale .iso-bak files from a prior botched run that
  # mutated originals in-place (the old approach). This makes migration safe.
  # The mv's are race-guarded: two concurrent runs can both see the same stale
  # backup, and the loser's mv (the FINAL command of its AND-list — final-
  # command failures DO trip set -e) would otherwise die pre-claim with a raw
  # error. The survivor's restore wins; the loser proceeds with the restored
  # originals.
  if [ -f "${PORTS_FILE}.iso-bak" ] || [ -f "${COMPOSE_FILE}.iso-bak" ]; then
    warn "Stale .iso-bak files found from a prior crash — restoring originals"
    [ -f "${PORTS_FILE}.iso-bak" ] && mv "${PORTS_FILE}.iso-bak" "$PORTS_FILE" 2>/dev/null || true
    [ -f "${COMPOSE_FILE}.iso-bak" ] && mv "${COMPOSE_FILE}.iso-bak" "$COMPOSE_FILE" 2>/dev/null || true
  fi

  # Claim a slot for unique port offsets
  _claim_isolate_slot

  # Build the isolation name, incorporating the slot for uniqueness
  if [ -z "$name" ]; then
    name="showcase-iso${ISOLATE_SLOT}"
  fi

  ISOLATE_NAME="$name"
  export COMPOSE_PROJECT_NAME="$name"

  # Duplicate-name guard, claim-then-verify. The slot registry only enforces
  # SLOT uniqueness, but the idempotent pre-down below keys on the compose
  # project NAME: a second run reusing a live explicit name would get a
  # different slot yet the same compose project — its pre-down would silently
  # tear down the first run's containers mid-test (or a --keep-parked stack),
  # and two slots recording the same project would corrupt the liveness-reaping
  # signal. Re-running a name after clean teardown still works: the old slot
  # was released, so no record remains.
  #
  # We record our project on our own slot FIRST, and only THEN scan the other
  # slots. (Scan-then-write was a TOCTOU hole: two concurrent same-name claims
  # could both pass the scan and both record the name.) With write-then-scan,
  # the later writer of any concurrent pair is guaranteed to see the earlier
  # writer's record. Backoff is deterministic: we lose against any conflicting
  # record that does NOT strictly postdate ours (older or equal mtime — a
  # strictly NEWER record means the other claimant wrote after us, so its own
  # scan sees our record and IT backs off). Established runs always have older
  # records and therefore always win; two same-second claimants may BOTH back
  # off, which is safe (the names were colliding anyway — nobody tears down a
  # stack they don't own).
  #
  # The verify runs BEFORE the runs/<name> dir is created, so on the
  # conflict-die path ISOLATE_TMPDIR is still unset and the loser's EXIT-trap
  # cleanup removes ONLY its own slot dir — it can never touch the winner's
  # run dir.
  local our_record="$ISOLATE_SLOT_DIR/$ISOLATE_SLOT/project"
  echo "$name" > "$our_record"
  local our_mtime
  our_mtime="$(_file_mtime "$our_record")"
  local other_slot conflict_slot=""
  for other_slot in "$ISOLATE_SLOT_DIR"/[0-9]*; do
    [ -d "$other_slot" ] || continue
    local other_num
    other_num="$(basename "$other_slot")"
    [[ "$other_num" =~ ^[0-9]+$ ]] || continue
    if [ "$other_num" = "$ISOLATE_SLOT" ]; then
      continue
    fi
    local other_proj
    other_proj="$(cat "$other_slot/project" 2>/dev/null || true)"
    [ "$other_proj" = "$name" ] || continue
    local other_mtime
    other_mtime="$(_file_mtime "$other_slot/project")"
    # Record vanished between the read and the stat (a concurrent loser
    # backing off, or a sweep) — no conflict.
    [[ "$other_mtime" =~ ^[0-9]+$ ]] || continue
    if ! [[ "$our_mtime" =~ ^[0-9]+$ ]] || [ "$other_mtime" -le "$our_mtime" ]; then
      conflict_slot="$other_num"
      break
    fi
    # Other record strictly postdates ours → the other claimant is the loser
    # of this pair (its post-write scan sees our older record); keep scanning.
  done
  if [ -n "$conflict_slot" ]; then
    die "isolate name '$name' is already in use by slot $conflict_slot — pick another name, or tear the existing stack down first: docker compose -p $name down --remove-orphans --volumes (if no such run exists, the record may be stale — the sweep is skipped while another run holds the lock; re-running usually resolves it)"
  fi

  # The rewriters below need python3 — check now, with a clear message, while
  # the runs/<name> dir does not exist yet (a die here leaves only our slot
  # for the EXIT trap to clean).
  command -v python3 >/dev/null 2>&1 || die "python3 is required for --isolate"

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
  # Pass slug via env var instead of bash-interpolating into the python
  # source — a slug containing a single quote would break the python literal.
  # Internal-tool risk only (slug is developer-typed), but cheap to harden.
  SHOWCASE_ISO_SLUG="$slug" python3 -c "
import os, re
with open('$COMPOSE_FILE') as f:
    content = f.read()

def offset_port(m):
    indent = m.group(1)
    host = int(m.group(2))
    container = m.group(3)
    return f'{indent}- \"{host + $ISOLATE_PORT_OFFSET}:{container}\"'

content = re.sub(r'(\s+)- \"(\d+):(\d+)\"', offset_port, content)
content = content.replace('container_name: showcase-', 'container_name: $name-')

# Forward-stack self-id label: stamp every isolated service's container with
# 'com.copilotkit.showcase.isolate=1' so 'showcase reap' can identify a
# harness-owned isolated project even when its slot record and run dir are
# both gone (e.g. a user-supplied --isolate <name> orphan). Injected as a
# 'labels:' block right after each service-level 'container_name:' directive
# (4-space indent, line start — a commented mention like the 8-space
# '# container_name:' note never matches). 'labels' under a service is a
# compose-native key; a service may legitimately already define labels, but
# this compose file defines none, so a fresh block is unambiguous.
content = re.sub(
    r'(?m)^(    )container_name: ([^\n]+)$',
    lambda m: m.group(1) + 'container_name: ' + m.group(2) + '\n'
              + m.group(1) + 'labels:\n'
              + m.group(1) + '  com.copilotkit.showcase.isolate: \"1\"',
    content,
)

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

# Per-slug LOCAL_SERVICES_JSON override. The persistent stack hardcodes the
# roster to langgraph-python's agentic-chat (a fast N=1 local-demo default).
# An iso stack scoped to a DIFFERENT slug would inherit that value and the
# harness's railway-services local-injection seam would enumerate the wrong
# service. Rewrite the line to point at the requested slug. Demos are sourced
# from the slug's manifest.yaml; if absent or unparseable, fall back to the
# representative d5 cell ('agentic-chat') so the iso run still targets the
# right container — just with a narrower demo set than d6 would normally use.
SLUG = os.environ.get('SHOWCASE_ISO_SLUG', '')
if SLUG:
    import json as _json
    _os = os
    demos = []
    for _mp in (
        _osp.join(ROOT, 'integrations', SLUG, 'manifest.yaml'),
        _osp.join(ROOT, 'packages', SLUG, 'manifest.yaml'),
    ):
        if _os.path.exists(_mp):
            with open(_mp) as _mf:
                _in_demos = False
                for _line in _mf:
                    _stripped = _line.rstrip('\n')
                    if re.match(r'^demos:\s*$', _stripped):
                        _in_demos = True
                        continue
                    if _in_demos:
                        if re.match(r'^\S', _stripped):
                            break
                        _m = re.match(r'^\s+-\s+id:\s*[\"\']?([A-Za-z0-9_\-]+)', _stripped)
                        if _m:
                            demos.append(_m.group(1))
            break
    if not demos:
        demos = ['agentic-chat']
    _override = _json.dumps([{
        'name': f'showcase-{SLUG}',
        'publicUrl': f'http://{SLUG}:10000',
        'demos': demos,
    }])
    # Replace the entire folded-scalar LOCAL_SERVICES_JSON=[...] payload line.
    # docker-compose.local.yml writes it as:  '        LOCAL_SERVICES_JSON=[...]'
    content = re.sub(
        r'(^\s+)LOCAL_SERVICES_JSON=\[[^\n]*\]',
        lambda m: m.group(1) + 'LOCAL_SERVICES_JSON=' + _override,
        content,
        flags=re.MULTILINE,
    )

with open('$tmp_compose', 'w') as f:
    f.write(content)
"

  # Override shell variables so all downstream code uses the temp files.
  # Originals are NEVER mutated.
  COMPOSE_FILE="$tmp_compose"
  COMPOSE_CMD="docker compose -f $COMPOSE_FILE --project-name $name"
  PORTS_FILE="$tmp_ports"

  # Only NOW is it safe for restore_isolation to compose-down: COMPOSE_CMD
  # points at the isolated project (see the note at the top of this function).
  ISOLATE_ACTIVE=true

  # Export for the TS harness CLI (config.ts / lifecycle.ts honor these).
  # Without SHOWCASE_COMPOSE_FILE the harness hardcodes the default compose
  # path, causing container-name collisions on a second concurrent --isolate.
  # SHOWCASE_INFRA_PORT_OFFSET shifts the hardcoded :4010/:8090/:3210 health
  # checks onto the isolated stack's offset host ports (otherwise the harness
  # would silently report the DEFAULT-project aimock/pocketbase as healthy).
  export LOCAL_PORTS_FILE="$tmp_ports"
  export SHOWCASE_COMPOSE_FILE="$tmp_compose"
  export SHOWCASE_INFRA_PORT_OFFSET="$ISOLATE_PORT_OFFSET"

  # Offset host-side URLs so any harness code referencing config.aimockUrl /
  # dashboardUrl / pocketbase.url talks to THIS project's instances (not the
  # default :4010 / :3210 / :8090).
  local aimock_host_port=$(( 4010 + ISOLATE_PORT_OFFSET ))
  local dashboard_host_port=$(( 3210 + ISOLATE_PORT_OFFSET ))
  local pocketbase_host_port=$(( 8090 + ISOLATE_PORT_OFFSET ))
  export AIMOCK_URL_LOCAL="http://localhost:${aimock_host_port}"
  export DASHBOARD_URL_LOCAL="http://localhost:${dashboard_host_port}"
  export DASHBOARD_PORT_LOCAL="$dashboard_host_port"
  export POCKETBASE_URL_LOCAL="http://localhost:${pocketbase_host_port}"

  # Idempotent: tear down any prior run with this name. --volumes matches
  # every other teardown path (automatic, --keep notice, failed-down
  # recovery) — without it a reused name inherits the prior crashed run's
  # named volumes, i.e. stale DB state. A failure here is non-fatal (the
  # common case is simply "nothing to tear down"), but it must not be SILENT:
  # leftover containers/volumes from a prior crashed run are exactly the state
  # this pre-clean exists to remove, so at least warn that they may remain.
  local pre_down_err=""
  if ! pre_down_err="$($COMPOSE_CMD down --remove-orphans --volumes 2>&1 >/dev/null)"; then
    warn "pre-clean of project $name failed — stale containers/volumes may remain${pre_down_err:+: ${pre_down_err}}"
  fi

  info "Isolation active: project=$name slot=$ISOLATE_SLOT ports=+$ISOLATE_PORT_OFFSET tmpdir=$ISOLATE_TMPDIR"
}

restore_isolation() {
  if ! $ISOLATE_ACTIVE; then
    # Half-initialized: apply_isolation died AFTER _claim_isolate_slot but
    # BEFORE ISOLATE_ACTIVE=true (duplicate name, python3 failure, ...). The
    # not-active guard exists to protect the user's DEFAULT stack from a
    # compose-down, and that protection stays absolute — clean up ONLY our own
    # state (the claimed slot dir and the runs/<name> scratch dir), with no
    # compose command of any kind. With no slot claimed this remains a pure
    # no-op.
    if [ -n "$ISOLATE_SLOT" ]; then
      if [ -n "$ISOLATE_TMPDIR" ] && [ -d "$ISOLATE_TMPDIR" ]; then
        rm -rf "$ISOLATE_TMPDIR" 2>/dev/null || true
      fi
      _release_isolate_slot
    fi
    return 0
  fi
  if $ISOLATE_ACTIVE; then
    # --keep: leave the stack standing. Do NOT compose-down, do NOT remove the
    # run dir, do NOT release the slot — the live containers keep the slot from
    # being reaped (the stale-sweep in _claim_isolate_slot treats a slot whose
    # project has live containers as in use). Print a survival notice with
    # everything needed to reach and later tear down the stack by hand.
    if [ "${ISOLATE_KEEP:-false}" = true ]; then
      local aimock_host_port=$(( 4010 + ISOLATE_PORT_OFFSET ))
      local dashboard_host_port=$(( 3210 + ISOLATE_PORT_OFFSET ))
      local pocketbase_host_port=$(( 8090 + ISOLATE_PORT_OFFSET ))
      info "Kept isolated group standing: project=$ISOLATE_NAME slot=$ISOLATE_SLOT"
      info "  aimock:     http://localhost:${aimock_host_port}"
      info "  dashboard:  http://localhost:${dashboard_host_port}"
      info "  pocketbase: http://localhost:${pocketbase_host_port}"
      info "  tear down:  docker compose -p $ISOLATE_NAME down --remove-orphans --volumes && rm -rf \"$ISOLATE_TMPDIR\" \"$ISOLATE_SLOT_DIR/$ISOLATE_SLOT\""
      # Derive the human-readable hours from ISOLATE_KEEP_TTL so an overridden
      # SHOWCASE_ISOLATE_KEEP_TTL can't leave a stale "(4h)" contradicting the
      # seconds. Only append the parenthetical for a whole number of hours; a
      # non-integer-hour TTL drops it rather than print a misleading fraction.
      local ttl_hours_note=""
      if [ $(( ISOLATE_KEEP_TTL % 3600 )) -eq 0 ]; then
        ttl_hours_note=" ($(( ISOLATE_KEEP_TTL / 3600 ))h)"
      fi
      info "  NOTE: this kept stack is auto-reaped after ${ISOLATE_KEEP_TTL}s${ttl_hours_note} if left running with no owner — run 'showcase reap' to tear down sooner, or 'showcase up' to keep using it."
      ISOLATE_ACTIVE=false
      # Disown the surviving state: with ISOLATE_ACTIVE back to false, a
      # repeated restore_isolation would otherwise hit the half-initialized
      # cleanup above and silently destroy the kept slot + run dir.
      ISOLATE_SLOT=""
      ISOLATE_TMPDIR=""
      return 0
    fi

    info "Tearing down isolated group: $ISOLATE_NAME (slot $ISOLATE_SLOT)"
    # Belt-and-suspenders: only compose-down when the isolated state is fully
    # initialized — a non-empty isolated project name AND COMPOSE_CMD actually
    # repointed at that project. A half-initialized state (e.g. die() partway
    # through apply_isolation) must never down the user's default stack.
    # Unreachable today (apply_isolation sets ISOLATE_ACTIVE only after the
    # repoint), but if state ever diverges, the mismatch branch below must be
    # SAFE: skipping the down while still deleting the run dir and releasing
    # the slot would manufacture the exact split-brain documented at the
    # failed-down branch — a possibly-running stack whose only compose state
    # is gone and whose slot is reclaimable.
    # End-anchored (no trailing *): the project name is the FINAL token of
    # COMPOSE_CMD as built by apply_isolation, and a substring match would let
    # '--project-name foo2' satisfy the guard for ISOLATE_NAME=foo (prefix
    # collision) — pointing the compose-down at the wrong project.
    if [ -z "$ISOLATE_NAME" ] || [[ "$COMPOSE_CMD" != *"--project-name $ISOLATE_NAME" ]]; then
      warn "Isolation state mismatch: ISOLATE_ACTIVE=true but COMPOSE_CMD is not pointed at project '${ISOLATE_NAME:-<unset>}' — skipping compose-down (unknown target)"
      warn "Preserving run dir and slot $ISOLATE_SLOT for manual recovery:"
      # With an EMPTY ISOLATE_NAME there is no compose project to name — a
      # 'docker compose -p  down' hint would be malformed; print only the
      # state-cleanup half in that case.
      if [ -n "$ISOLATE_NAME" ]; then
        warn "  tear down:  docker compose -p $ISOLATE_NAME down --remove-orphans --volumes && rm -rf \"$ISOLATE_TMPDIR\" \"$ISOLATE_SLOT_DIR/$ISOLATE_SLOT\""
      else
        warn "  clean up:   rm -rf \"$ISOLATE_TMPDIR\" \"$ISOLATE_SLOT_DIR/$ISOLATE_SLOT\""
      fi
      ISOLATE_ACTIVE=false
      # Disown the kept-for-recovery state (see the --keep branch above): a
      # repeated restore_isolation must not destroy it via the
      # half-initialized cleanup.
      ISOLATE_SLOT=""
      ISOLATE_TMPDIR=""
      return 0
    fi
    # Fail-loud: a silently failed compose-down (stderr to /dev/null,
    # `|| true`) once left the stack RUNNING while the run dir — the only
    # copy of the rewritten compose file — and the slot were deleted out
    # from under it: live containers with no state and a re-claimable slot
    # (port collisions). On failure, keep the run dir AND the slot (same as
    # --keep) and print the manual teardown command so recovery is possible.
    # --volumes keeps the automatic teardown consistent with both printed
    # manual teardown commands (keep notice + failed-down recovery above and
    # below): isolated test stacks are ephemeral, and without it every run
    # leaks project-scoped named volumes (unbounded for explicit names).
    if ! $COMPOSE_CMD down --remove-orphans --volumes; then
      warn "compose down FAILED for isolated project $ISOLATE_NAME — stack may still be running"
      warn "Keeping run dir and slot $ISOLATE_SLOT for manual recovery:"
      warn "  tear down:  docker compose -p $ISOLATE_NAME down --remove-orphans --volumes && rm -rf \"$ISOLATE_TMPDIR\" \"$ISOLATE_SLOT_DIR/$ISOLATE_SLOT\""
      ISOLATE_ACTIVE=false
      # Disown the kept-for-recovery state (see the --keep branch above):
      # a repeated restore_isolation must not destroy it via the
      # half-initialized cleanup.
      ISOLATE_SLOT=""
      ISOLATE_TMPDIR=""
      return 0
    fi
    # Just remove the temp dir — originals were never touched
    if [ -n "$ISOLATE_TMPDIR" ] && [ -d "$ISOLATE_TMPDIR" ]; then
      rm -rf "$ISOLATE_TMPDIR" 2>/dev/null || true
    fi
    # Release the isolation slot so other runs can claim it
    _release_isolate_slot
    ISOLATE_ACTIVE=false
  fi
}
