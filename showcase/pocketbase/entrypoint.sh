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

# su-exec preserves argv verbatim and exec()s, so PocketBase runs as
# PID 1 and sees the same arguments the ENTRYPOINT line would have
# passed. Using `exec` here (instead of spawning su-exec as a child)
# means no extra process sits between Railway's signal handling and PB.
exec su-exec pocketbase:pocketbase /usr/local/bin/pocketbase "$@"
