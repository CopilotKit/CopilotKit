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
# The sweep lock is held only for the duration of one sweep pass (seconds, even
# with all 46 slots populated). A crashed sweeper's leftover lock must not
# disable stale reaping for the full 2-hour SLOT threshold — give the lock its
# own, much shorter staleness threshold.
ISOLATE_SWEEP_LOCK_STALE_THRESHOLD=60  # seconds

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

# Claim an isolation slot using atomic mkdir. Slots start at 0 and increment.
# Each slot dir contains a "pid" file for stale-detection. The port offset is
# (slot + 1) * 200, so slot 0 → +200, slot 1 → +400, etc.
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
    local slot_proj has_proj=false
    slot_proj="$(cat "$slot_entry/project" 2>/dev/null || true)"
    if [ -n "$slot_proj" ]; then
      has_proj=true
      local live_containers
      if ! live_containers="$(docker ps -q --filter "label=com.docker.compose.project=$slot_proj" 2>/dev/null)"; then
        warn "Cannot verify liveness of slot $slot_name (docker ps failed) — leaving it alone"
        continue
      fi
      if [ -n "$live_containers" ]; then
        # Live containers → in use (covers --keep'd stacks whose owner exited).
        continue
      fi
      # Zero live containers is inconclusive (project file is written before
      # the containers start) — fall through to the owning-PID check.
    fi
    local slot_pid_file="$slot_entry/pid"
    local slot_pid="" pid_file_present=false
    if [ -f "$slot_pid_file" ]; then
      pid_file_present=true
      slot_pid="$(cat "$slot_pid_file" 2>/dev/null || true)"
    fi
    if [[ "$slot_pid" =~ ^[0-9]+$ ]]; then
      if kill -0 "$slot_pid" 2>/dev/null; then
        # Live owning PID always protects the slot.
        continue
      fi
      info "Attempting to reclaim stale slot $slot_name (PID $slot_pid dead)"
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

# Contract: callers MUST arm `trap restore_isolation EXIT` BEFORE calling this
# function (cmd-test.sh does). Every die() below — invalid name, slot
# exhaustion, duplicate-name conflict, rewriter failure — relies on that trap
# for cleanup of the claimed slot (and, once created, the runs/<name> dir).
apply_isolation() {
  local name="${1:-}"
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

  # Only NOW is it safe for restore_isolation to compose-down: COMPOSE_CMD
  # points at the isolated project (see the note at the top of this function).
  ISOLATE_ACTIVE=true

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
      local dashboard_host_port=$(( 3200 + ISOLATE_PORT_OFFSET ))
      local pocketbase_host_port=$(( 8090 + ISOLATE_PORT_OFFSET ))
      info "Kept isolated group standing: project=$ISOLATE_NAME slot=$ISOLATE_SLOT"
      info "  aimock:     http://localhost:${aimock_host_port}"
      info "  dashboard:  http://localhost:${dashboard_host_port}"
      info "  pocketbase: http://localhost:${pocketbase_host_port}"
      info "  tear down:  docker compose -p $ISOLATE_NAME down --remove-orphans --volumes && rm -rf \"$ISOLATE_TMPDIR\" \"$ISOLATE_SLOT_DIR/$ISOLATE_SLOT\""
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
