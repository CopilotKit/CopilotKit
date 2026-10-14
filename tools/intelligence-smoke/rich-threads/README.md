# Bounded row1 Railway milestone

The agreed 2026-10-12 merge boundary for PR #7709 is PNI-605 infrastructure plus
`row1-text-query-data-v1` on **Mastra and Strands TypeScript**, using the actual
shared Showcase application. One fresh conversation per framework sends text,
executes the real `query_data` tool, receives its result, and displays the final
assistant reply. Frameworks run serially in an isolated Railway environment.

Expanded row1 (charts, media and approvals), rows2–6, and the other five
frameworks are deferred. They are not validated or silently treated as N/A.
See [preservation.json](preservation.json) for the original heads and file
inventory retained before narrowing. Historical broad-scope evidence retains
its original verdict; it does not establish this milestone's acceptance.

## Independent oracle

The runtime records native inputs/events before middleware and canonical Phoenix
payloads before ingestion. Exact-ID retries retain a separate attempt log.
The expected transcript/state uses the pinned public AG-UI consumer, independently
of Intelligence's reducer. The durable reader separately reads scoped SQL events
and the public transcript API. Only validated gateway-added `organization_id`
and `metadata.cpki_ingested` are removed; full raw rows remain in evidence.

Row1 compares thread, agent, user and ordered run identities; every event
occurrence; messages, tool arguments/results and their associations; state; and
pending entries. Successful terminal events, an actual query result, a subsequent
assistant reply and visible browser text are mandatory. A faithfully persisted
model failure does not pass the journey. Screenshots must reside in the owned
output directory. No destination records are synthesized as expectations.

## Setup and checks

```sh
pnpm nx run intelligence-smoke:rich-threads-setup
pnpm nx run intelligence-smoke:rich-threads-test
pnpm nx run intelligence-smoke:rich-threads-driver-test
pnpm nx run intelligence-smoke:lint
```

Unit tests deliberately corrupt envelopes and tool associations. Driver tests use
real Chromium with a local control page. Both are supplemental harness checks,
not hosted Showcase acceptance. Preflight imports only row1 and its service
factory. Selecting deferred rows fails before provisioning.

The acceptance boundary requires two successive clean hosted runs and a
deliberately failed run with verified cleanup. Preserve setup, timeout,
cancellation and interruption evidence; disclose recovery modes not exercised.
No ticket completion or parity-matrix change follows from unit results.

## Application and native services

`application/page.tsx` wraps the same existing Beautiful Chat page for both
frameworks. `prepare.mjs` stages one committed Git revision and exact package
pins into a build context. `application/package-pins.json` records a public
compile baseline, not proof that candidate source ran. Registry versions and
candidate tarball SHA-256 values are recorded in the prepared manifest.

The application and runtime share the staged image. Runtime command:
`node /app/rich-threads/runtime.mjs`. Mastra command:
`node --import tsx /app/rich-threads/application/mastra-backend.mjs`, with
`RICH_THREADS_MASTRA_SOURCE=/app/src/mastra/index.ts` and
`TSX_TSCONFIG_PATH=/app/tsconfig.json`. Its handler runs the registered
Beautiful Chat agent. Strands uses its actual Showcase server and durable
session wrapper. Native stores must be owned volumes, independently inspected
before the conversation. Reviewed immutable images are required for deployment.

`runtime.mjs` consumes private `RICH_THREADS_RUNTIME_CONFIG`: capture directory
and token, API/gateway URLs, API key, and framework scopes with agent/user IDs
and a `rich` native route. Original capture is available over authenticated
HTTPS; the token must contain at least 32 characters. The client refuses
redirects and bounds requests. Keep credentials and private configuration out
of source, reports and exception messages.

## Railway and controller boundary

PNI-605 owns provider creation, readiness, clean-store inspection, durable locks,
registry distribution and verified deletion. The merged PNI-607 registry code
still requires activation at the actual image-gate, Ruby and harness readers.
The controller must be durable and outside the disposable environment, with
persistent authority/record paths and an external recovery service. An ephemeral
Actions job is not that controller. The supervisor must launch the Node worker
directly; it enforces a 50-minute worker budget inside the 60-minute lifetime.

A private launch manifest supplies approved immutable image digests, actual
receiver bindings and automation credentials. Canonical pinned Intelligence
bootstrap creates only logical organization/project/key configuration before
application startup. Clean-scope exceptions must name exact bootstrap tables
and counts, never conversation data. Approval or receiver activation cannot be
invented by the harness.

Provider-returned URLs and ownership IDs bind every scope. Cleanup must verify
that all owned services, volumes and environments are absent; a successful delete
response is insufficient. Failure evidence and durable locks survive incomplete
cleanup. No shared Showcase service may be reset or restarted.

The manual reference comparison is retained separately. The reference has been
seen during prior work, so subsequent results are not a blind comparison.

## Controller configuration placeholders

The manual workflow requires a registered `self-hosted, linux,
rich-threads-controller` runner, `RICH_THREADS_CONTROLLER_CONFIG` pointing to its
private template and `RICH_THREADS_EVIDENCE_ROOT` pointing to durable evidence
storage. These are deployment requirements, not provisioned resources. Authority
and recovery configuration must live outside the Actions checkout and temp dirs.

`rich-threads-acceptance -- --config=<template> --output=<new-directory>` runs the
three-attempt sequence. Template strings can use `{{run:apiKey}}`,
`{{run:captureToken}}`, `{{run:userId}}`, `{{run:databasePassword}}`,
`{{run:organizationId}}`, `{{run:organizationSlug}}` and `{{run:projectSlug}}`.
Use matching placeholders in service environment and database credentials.
The materializer supplies the canonical hash-only `BOOTSTRAP_CONFIG_B64` to
Postgres and fresh scope IDs. The provider resolves `{{bootstrap:projectId}}`
after committed bootstrap. Runtime JSON can be supplied privately as
`RICH_THREADS_RUNTIME_CONFIG_JSON` in the service environment.

Per-attempt private files live beside the private template, outside exported
evidence. They are removed only after verified cleanup; retain them with the
durable journal for interrupted recovery. The four logical bootstrap tables
(organizations, product_actors, projects, api_keys) each expect one record for
this fresh single-organization bootstrap. Migration bookkeeping counts still
need verification against the exact image. Audit content requires the provider's
separate exact bootstrap audit check; never exempt arbitrary event rows.
