# Rich-thread environment lifecycle

`createEnvironment({config, runId, frameworks, outputDir, signal})` supplies the
common bootstrap with `{baseline, scopes, receipt, restart, cleanup}`. The bootstrap
creates one environment, runs rows serially and always awaits cleanup. Row5 calls
`restart(role, framework)` for API, gateway, application runtime and native backend;
the returned receipts retain the original storage bindings and changed container
start identities. Database and cache are never reset during a row.

The implemented provider is **Docker development only**. PNI-605's hosted target,
credentials, authorization and operational limits remain undecided. Acceptance
configuration is rejected. This module and its fault-injection tests do not prove
that the live Showcase matrix or hosted cleanup acceptance has passed.

## Private launch configuration

The common bootstrap owns actual image build/provision configuration. It must
supply installable digest-pinned images of the real Showcase/API services:

```js
{
  purpose: "development",
  provider: "docker",
  dockerHost: "unix:///absolute/path/to/docker.sock",
  directory: "/absolute/existing/private/run-parent",
  baseline, // common source/package/provenance schema
  services: [{
    name: "native-mastra",
    role: "native-backend",
    framework: "mastra",
    image: "registry/real-showcase-mastra@sha256:<64 hex characters>",
    env: { /* private single-line environment values */ },
    args: [],
    ports: [{host: 46605, container: 3000}],
    mounts: [{store: "mastra", target: "/data"}],
    ready: ["node", "/app/readiness.mjs"],
  }],
  scopes: {
    mastra: {
      userId, agentId, organizationId, projectId,
      applicationUrl, runtimeUrl, apiUrl, gatewayUrl,
      credentials: {apiKey}, databaseUrl, model,
      native: {
        store: "mastra", path: "memory.db",
        workflowStore: "mastra", workflowPath: "workflow.db",
        agentId, resourceId,
      },
    },
  },
}
```

For a locally built development image, `image` may be its immutable
`sha256:<config digest>` from the source build receipt. Mutable tags are rejected.
`config.files: [{store, path, contents}]` writes private runtime configuration into
an owned mounted store using exclusive mode-0600 files. Use a dedicated config
store, separate from the native data roots checked for absence. For capture files,
`scope.capture.store` resolves to `scope.capture.directory` on the host.

Every required role must be configured: `database`, `cache`, `intelligence-api`,
`intelligence-gateway`, `application-runtime`, `native-backend` for each framework,
and `application`. Service names are network aliases; container peers use those
aliases. Published ports bind to host loopback. Native mount paths in the service
environment must agree with scope filenames. Scope native locations are resolved
to owned host paths for independent readers. All storage must be explicit bind
mounts; undeclared image volumes are rejected and removed during cleanup.

The run directory is created exclusively. Existing directories fail without
modification, including interrupted runs. Fresh physical storage is recorded in
`storageInitialization`. `cleanScope` remains **unverified** until the common
bootstrap performs logical database, cache/queue, native-memory and media absence
checks after migrations/bootstrap. Supplying fresh user/thread IDs is insufficient.

Before running rows, call `environment.verifyCleanScope({pool, redis,
bootstrapTables, nativeBootstrapTables})`. It uses a read-only PostgreSQL
transaction over all non-system tables, Redis `INFO keyspace` across all databases,
and complete native-directory/SQLite scans. Bootstrap exceptions must explicitly
name a table, expected count and reason; conversation, resource-memory, queue and
media tables cannot be exempted. Unknown files, including media sidecars and Strands
snapshots, invalidate a clean run. The lifecycle writes the evidence and throws if
any count is unexpected. The supplied clients must connect to this environment's
owned database/cache; common configuration must bind those private connections.

## Failure and recovery

The provider records creation intent before Docker calls. Readiness is bounded;
setup failure attempts cleanup before propagating failure. Cancellation initiates
cleanup; the caller still awaits `cleanup()` so failure affects the suite verdict.
Cleanup verifies exact owner labels and container IDs, removes containers and their
anonymous volumes, verifies the network disappeared, then removes the private data
directory. Any failed resource removal retains that directory for recovery.

`environment-N.json` checkpoints are append-only; `environment.json` holds the
latest public status. Neither contains launch environment values or credentials.
Raw Docker output is never published. Recovery is explicit:

```js
await recoverEnvironment({ receiptPath, dockerHost });
```

Recovery verifies the directory ownership marker, container labels/IDs and network
label again. It writes a separate recovery receipt and rejects on any failure.
Never manually reset/delete a directory merely because setup timed out.

Pending validation: actual immutable launch configuration, real clean-scope checks,
two full successive runs, failure/timeout/cancellation cleanup against Docker, and
approved hosted execution. The seven-framework scope remains; concrete lifecycle
validation currently accepts only the first required Mastra/Strands TypeScript pair.
