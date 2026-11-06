#!/bin/bash
# Create the `cookbook` database user (idempotent).
#
# The Oracle Database Free image does not reliably auto-run scripts mounted into
# /opt/oracle/scripts/setup, so we run the init SQL explicitly against the running
# container. Run this once after `docker compose up -d` reports the DB ready
# ("DATABASE IS READY TO USE"). Safe to re-run.
set -euo pipefail

CONTAINER="${ORACLE_CONTAINER:-oracle-cookbook-db}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Error: container '$CONTAINER' is not running. Start it with: docker compose up -d" >&2
  exit 1
fi

echo "Ensuring the 'cookbook' user exists in FREEPDB1..."
docker exec "$CONTAINER" bash -lc \
  'echo exit | "$ORACLE_HOME"/bin/sqlplus -s "/ as sysdba" @/opt/oracle/scripts/setup/01-create-user.sql'
echo "Done — the 'cookbook' user is ready."
