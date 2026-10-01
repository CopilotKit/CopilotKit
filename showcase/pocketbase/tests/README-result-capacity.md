# PocketBase result capacity regression

Run against two locally built official PocketBase images: one from before the
capacity migration and one from this checkout. Docker must use a local engine
sharing the caller's filesystem and loopback.

From the candidate repository root:

```sh
REPO_ROOT="$(git rev-parse --show-toplevel)"
BASELINE_ROOT=/absolute/path/to/pre-capacity-checkout
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  docker build -f "$BASELINE_ROOT/showcase/pocketbase/Dockerfile" \
  -t showcase-pocketbase:capacity-baseline "$BASELINE_ROOT/showcase/pocketbase"
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  docker build -f "$REPO_ROOT/showcase/pocketbase/Dockerfile" \
  -t showcase-pocketbase:capacity-candidate "$REPO_ROOT/showcase/pocketbase"
PB_TEST_BASELINE_IMAGE=showcase-pocketbase:capacity-baseline \
PB_TEST_CANDIDATE_IMAGE=showcase-pocketbase:capacity-candidate \
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  node "$REPO_ROOT/showcase/pocketbase/tests/result-capacity.integration.mjs"
```

The driver creates uniquely named disposable databases, binds only to loopback,
and removes its containers, volumes, and temporary migration files after the run.
It accepts no external database URL or existing volume. Use Docker's current
local context for both builds and the run.

The fixed payload exceeds the old 65,536-byte limit. Checks prove baseline
rejection, full readback after upgrading the same row, the finite 2,000,000-byte
limit, fresh installs, preserved larger limits, migration guards and idempotence,
and data retention across application-image rollback and re-upgrade. Malformed
schemas use private fixture migrations, excluded from the production image.
No down migration is executed.
