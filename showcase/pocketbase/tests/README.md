# Selected observation transaction checks

Run against a **private, disposable PocketBase 0.22 database**. These checks create
status, history, and queue rows and inject failures using files inside that
container. Never point them at staging or production.

Build `showcase/pocketbase/Dockerfile` locally, then start the image with the local
admin `local-proof@example.test` / `local-proof-password-only`. Mount
`observations-faults.pb.js` into `/pb_hooks/observations-test-faults.pb.js`; this
fault hook is test-only and is excluded from the production Dockerfile.

```sh
PB_TEST_URL=http://127.0.0.1:43121 \
PB_TEST_CONTAINER=your-private-container \
node showcase/pocketbase/tests/observations.integration.mjs
```

The tests exercise the real authenticated route and database transactions:
status/history/receipt failure rollback, durable replay, concurrent requests,
prior-row conflicts, new jobs with equal timestamps, history fallback replay,
receipt capacity validation, and a lost HTTP response after commit. The fault
controls use `docker --context desktop-linux` and always remove their markers.

`PB_TEST_MODE=legacy` demonstrates the old separate status/history persistence
boundary and intentionally fails the rollback assertion. It is a direct REST
boundary demonstration, not a claim to invoke the TypeScript status writer.
Actual consumer/writer red-green proof belongs to the harness integration gate.

`PB_TEST_MODE=missing-schema` expects the endpoint with the new migration absent;
it verifies a loud failure with no status/history mutation. Apply the migration
and rerun the ordinary checks to verify the corrected boundary.
