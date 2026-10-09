#!/bin/sh
# Entrypoint shim for PocketBase.
#
# A fresh Railway volume mounted at /pb_data is owned by root:root — the
# build-time `chown pocketbase:pocketbase /pb_data` is clobbered by the
# volume mount at container start. Without this shim, `USER pocketbase`
# drops privileges BEFORE the volume is writable and PB exits with
# "permission denied" when it tries to open the SQLite file.
#
# Runtime fix: start as root, fix ownership on the mounted volume, then
# drop to the `pocketbase` user via `su-exec` (alpine's equivalent to
# gosu — single-static-binary, ~30 KB). We shell out to `exec` so PB
# becomes PID 1 and receives SIGTERM / SIGINT directly — crucial for
# graceful Railway shutdowns.
set -eu

# Make the volume writable for the pocketbase uid. Idempotent — running
# chown on an already-correctly-owned tree is cheap (no-op per inode).
chown -R pocketbase:pocketbase /pb_data

# Bootstrap the admin/superuser on a FRESH volume so the harness can
# authenticate. A fresh local volume (and any new Railway volume) has no
# admin account, so the harness's superuser auth 400s ("validation_is_email" /
# "Failed to authenticate") and the whole fleet wedges (no enqueue, no consume,
# no worker roster). Staging volumes that were set up by hand already have one —
# `admin create` then errors "already exists", which we swallow so this is
# idempotent.
#
# ORDERING IS LOAD-BEARING: `admin create` needs the schema initialized, so
# migrations MUST run first ("Migration are not initialized yet. Please run
# 'migrate up'") — otherwise the create fails and, because the worker's initial
# self-register (the only write that sets the required `registered_at`) then
# also fails against the missing admin, the worker never appears in the roster.
# We run `migrate up` then `admin create`, both BEFORE `serve`.
#
# PB 0.22 ships `migrate up` + `admin create <email> <password>` (0.23+ renamed
# the latter `superuser upsert`); this image is pinned to 0.22.21. The email
# MUST have a TLD — PB 0.22 rejects bare hosts like `admin@localhost` as
# invalid, which is exactly the misconfig that hid this gap.
if [ -n "${POCKETBASE_SUPERUSER_EMAIL:-}" ] && [ -n "${POCKETBASE_SUPERUSER_PASSWORD:-}" ]; then
  # FAIL HARD on a migration error. Previously `migrate up ... || true`
  # swallowed failures, so a failed/half-applied migration booted a broken PB
  # silently — surfacing later as opaque write 400s with no boot signal. With
  # `set -e` and no `|| true`, a real migration failure aborts boot (visible in
  # docker/Railway logs + healthcheck) instead of serving a corrupt schema. PB
  # 0.22's `migrate up` exits 0 on the benign "No new migrations to apply" case,
  # so a clean re-boot is NOT a non-zero we have to tolerate.
  su-exec pocketbase:pocketbase /usr/local/bin/pocketbase migrate up \
    --dir=/pb_data --migrationsDir=/pb_migrations 2>&1
  # `admin create` tolerates EXACTLY ONE failure: "already exists" on a staging
  # volume that already has a superuser (a fresh volume needs the create; an
  # existing one must not abort boot). The previous `... | grep -vi "already
  # exists" || true` swallowed the exit code of EVERY failure (the pipe's status
  # is grep's, and `|| true` masks even that), so a genuine create failure —
  # bad password policy, locked DB, disk full — booted a broken PB silently.
  #
  # Capture the create's combined output AND its real exit code explicitly. On
  # success (exit 0) we're done. On failure we ONLY tolerate the case where the
  # output contains "already exists"; ANY other failure re-emits the output and
  # aborts boot (set -e would also catch a bare non-zero, but we exit explicitly
  # so the failure is unmistakable in the logs).
  admin_create_output=$(su-exec pocketbase:pocketbase /usr/local/bin/pocketbase admin create \
    "$POCKETBASE_SUPERUSER_EMAIL" "$POCKETBASE_SUPERUSER_PASSWORD" \
    --dir=/pb_data 2>&1) && admin_create_rc=0 || admin_create_rc=$?
  printf '%s\n' "$admin_create_output"
  if [ "$admin_create_rc" -ne 0 ]; then
    if printf '%s' "$admin_create_output" | grep -qi "already exists"; then
      echo "entrypoint: superuser already exists — continuing (idempotent boot)"
    else
      echo "entrypoint: 'admin create' failed (exit $admin_create_rc) — aborting boot" >&2
      exit "$admin_create_rc"
    fi
  fi
fi

# su-exec preserves argv verbatim and exec()s, so PocketBase runs as
# PID 1 and sees the same arguments the ENTRYPOINT line would have
# passed. Using `exec` here (instead of spawning su-exec as a child)
# means no extra process sits between Railway's signal handling and PB.
exec su-exec pocketbase:pocketbase /usr/local/bin/pocketbase "$@"
