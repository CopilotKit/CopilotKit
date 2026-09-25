#!/usr/bin/env bash
# ============================================================================
# stop-demo.sh — one-command teardown for the reskinnable demo (self-hosted mode).
#
#   cd examples/showcases/reskinnable-demo && ./stop-demo.sh
#
# The companion to run-demo.sh. That script detaches everything except the
# Next.js dev server (`docker compose up -d`, native TEI and banking's Python
# agent via `nohup`, then `exec pnpm dev`), so Ctrl-C takes down ONLY the dev
# server and leaves the rest running. This script brings those leftovers down.
#
# Measured, because the shell rule behind it is not obvious: SIGINT goes to the
# foreground process GROUP, which includes the backgrounded children — but a
# NON-INTERACTIVE shell sets a background job to ignore SIGINT (POSIX), so they
# survive and only the exec'd dev server dies (`exit=-2`).
#
# It tears down, in order:
#   - the Next.js dev server on :3000 (defensive; usually already gone via Ctrl-C)
#   - banking's Python agent on :8124 (the `agent/` service; not a compose
#     service, so docker cannot reach it)
#   - the docker compose stack (project `reskinnable-demo-memory`) — containers only by
#     default, so a re-run of run-demo.sh reuses the built image + seeded data
#   - the native Metal TEI on :7067 (Apple Silicon only; the host process
#     run-demo.sh started outside docker's knowledge)
#
# The agent is the one whose absence here BITES rather than merely litters:
# run-demo.sh reuses a live :8124 (it health-checks before starting), so an
# orphan left running after a teardown is silently adopted by the next cold
# start — serving whatever code it was launched with. Editing `agent/` and
# re-running the script would then change nothing, which reads as the edit having
# no effect.
#
# Idempotent: safe to re-run — anything already down is skipped.
#
# Flags:
#   --purge   also delete the docker volumes (postgres/redis/minio/tei cache).
#             Full reset: next run-demo.sh re-seeds the DB and re-downloads the
#             embedding model. Without this, data + model cache persist.
#   --keep-tei   leave the native Metal TEI running (it's slow to warm up; handy
#                if you're only bouncing the stack and want to skip the reload).
# ============================================================================
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEMO_DIR"

PURGE=0
KEEP_TEI=0
for arg in "$@"; do
  case "$arg" in
    --purge)    PURGE=1 ;;
    --keep-tei) KEEP_TEI=1 ;;
    # Print only the leading banner: skip the shebang, then every comment
    # line up to the first non-comment line (stops before the code body).
    -h|--help)  awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/,""); print}' "$0"; exit 0 ;;
    *) printf 'unknown flag: %s (try --help)\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '    \033[1;33m!\033[0m %s\n' "$*"; }

# Kill whatever is listening on a TCP port (best-effort, no error if nothing is).
kill_port() { # port label
  local port="$1" label="$2" pids
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086 # word-splitting the pid list is intentional
    kill $pids 2>/dev/null || true
    sleep 1
    # Escalate to SIGKILL for anything that ignored SIGTERM.
    pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
    # shellcheck disable=SC2086
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    ok "$label on :$port stopped"
  else
    ok "$label on :$port already stopped"
  fi
}

# --- Next.js dev server -----------------------------------------------------
say "Stopping the Next.js dev server (:3000)"
kill_port 3000 "dev server"

# --- Banking's Python agent -------------------------------------------------
# No --keep flag, unlike TEI: this one boots in seconds, so there is nothing to
# save by leaving it up — and leaving it up is the failure described in the
# header (the next run-demo.sh adopts it, stale code and all).
say "Stopping banking's Python agent (:8124)"
kill_port 8124 "banking agent"

# --- Docker stack -----------------------------------------------------------
# run-demo.sh may have brought the stack up with or without the cpu-fallback
# `tei` profile. `down` ignores unknown profiles, but pass --profile so the
# profiled `tei` container is included in the teardown on amd64/CI.
say "Stopping the docker stack (project reskinnable-demo-memory)"
if docker info >/dev/null 2>&1; then
  DOWN_ARGS=(--profile cpu-fallback down --remove-orphans)
  if [ "$PURGE" -eq 1 ]; then
    DOWN_ARGS+=(--volumes)
    warn "--purge: deleting volumes (postgres data, redis, minio, tei model cache)"
  fi
  docker compose "${DOWN_ARGS[@]}"
  # `${PURGE:+…}` was wrong here and printed on EVERY run: the flag holds the
  # string "0" when unset, which is non-empty, so `:+` expands. The action was
  # always correct (--volumes is gated on `-eq 1`), but the line told anyone who
  # read it that their seeded Postgres data had just been deleted.
  if [ "$PURGE" -eq 1 ]; then
    ok "docker stack down (volumes removed)"
  else
    ok "docker stack down"
  fi
else
  warn "Docker is not running — assuming the stack is already down"
fi

# --- Native Metal TEI (Apple Silicon) ---------------------------------------
# The one piece docker doesn't manage: run-demo.sh starts text-embeddings-router
# on the host with nohup/disown. Only present on arm64; a no-op elsewhere.
if [ "$KEEP_TEI" -eq 1 ]; then
  say "Leaving native Metal TEI running (:7067) — --keep-tei"
else
  say "Stopping native Metal TEI (:7067)"
  kill_port 7067 "native TEI"
fi

say "Demo stopped."
[ "$PURGE" -eq 0 ] && printf '    (volumes kept — re-run ./run-demo.sh for a warm restart; use --purge for a clean slate)\n'
