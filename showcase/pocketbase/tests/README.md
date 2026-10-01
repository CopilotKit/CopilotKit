# PocketBase observation regressions

These checks create rows in a private, disposable PocketBase database. Run them
against the official image built from this checkout; never use staging or production.

From the repository root:

```sh
REPO_ROOT="$(git rev-parse --show-toplevel)"
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  docker build -f "$REPO_ROOT/showcase/pocketbase/Dockerfile" \
  -t showcase-pocketbase:observations-test "$REPO_ROOT/showcase/pocketbase"
```

Start a disposable container with a fresh volume, a loopback port, and
`POCKETBASE_SUPERUSER_EMAIL=local-proof@example.test` /
`POCKETBASE_SUPERUSER_PASSWORD=local-proof-password-only`. Then run:

```sh
PB_TEST_URL=http://127.0.0.1:43121 \
NX_DAEMON=false NX_TUI=false pnpm exec nx exec \
  --projects=@copilotkit/showcase-scripts -- \
  node "$REPO_ROOT/showcase/pocketbase/tests/observations.integration.mjs"
```

The checks cover authentication, history and receipt-capacity validation rollback,
malformed receipt rejection, durable replay, concurrent writes, stale prepared
plans, preserved worker results, and history fallback. They need no test hooks or
proxy. Remove the disposable container and volume after the run.
