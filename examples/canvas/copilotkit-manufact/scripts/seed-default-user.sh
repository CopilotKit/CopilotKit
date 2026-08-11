#!/usr/bin/env bash
# Seed the `default` and `1_default` users into Intelligence's Postgres.
#
# Why: the seed API key `cpk_sPRVSEED_seed0privat0longtoken00` that the BFF
# uses to talk to Intelligence resolves to userId='default' inside the
# casa-de-erlang org, but Intelligence's built-in migrations only seed three
# *demo* users (jordan-beamson / alex-typeson / cam-elsworth). The very first
# thread-create call from the BFF therefore fails with:
#   threads_user_id_fkey: Key (user_id)=(1_default) is not present in users
#
# This script is idempotent (ON CONFLICT DO NOTHING) and is safe to re-run.
# Wrapper: `npm run seed` (also runs automatically as part of `npm run dev:infra`).
set -euo pipefail

CONTAINER="${INTELLIGENCE_PG_CONTAINER:-hackathon-intelligence-notion-postgres-1}"
ORG_ID="${INTELLIGENCE_DEFAULT_ORG_ID:-casa-de-erlang}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: Postgres container '${CONTAINER}' not running. Did you run 'npm run dev:infra'?" >&2
  exit 1
fi

SQL="INSERT INTO cpki.users (id, organization_id, created_at) VALUES ('default', '${ORG_ID}', NOW()), ('1_default', '${ORG_ID}', NOW()) ON CONFLICT (id) DO NOTHING; SELECT id, organization_id FROM cpki.users WHERE id IN ('default','1_default');"

docker exec "$CONTAINER" psql -U intelligence -d intelligence_app -v ON_ERROR_STOP=1 -c "$SQL"
