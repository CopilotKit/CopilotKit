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

The permanent Railway scheduler/controller lives outside disposable environments.
Its durable volume retains ownership journals, cleanup progress, registry snapshots
and results across restarts. It runs one attempt every four hours, rejects overlap,
reconciles unfinished work on startup and periodically, and blocks new work until
cleanup succeeds. The permanent runner and its volume are never cleanup targets.
Each disposable environment has a maximum 60-minute lifetime; delayed cleanup is
reported and resumed after recovery. Persistent Showcase services remain untouched.

`one-run.mjs --config=<private-template> --output=<new-retained-directory>` performs
one fresh supervised attempt on both frameworks. `controller.mjs` runs the manual
three-attempt acceptance sequence. Both execute inside Railway. The supervisor
launches the Node worker directly and retains authoritative recovery state.

Actions only builds isolated images or calls the authenticated Railway runner API.
The trigger workflow requires `RICH_RUNNER_URL` and `RICH_RUNNER_TOKEN`, polls the
returned run ID, and exports retained evidence after validating its file hashes.
Run modes are `single`, `acceptance`, and `crash-recovery`. Crash acceptance must
interrupt the actual runner after resource creation, restart it, and demonstrate
journal recovery and owned resource deletion while retained results survive.
Local controls cannot establish that outcome.

The build-only workflow publishes SHA-tagged `rich-thread-application` and
`rich-thread-strands` repositories, without promotion or shared-service deployment.
It records digests for independent policy review; a successful build does not
approve its own image. Strands staging copies the actual agent and locked
package manifest from one committed revision. The common application's public
package pins remain explicit baseline qualifications.

Registry readers use the merged PNI-607 contract and require concrete activation.
Provider-returned URLs and IDs bind each scope. Cleanup verifies complete owned
service, volume and environment absence; delete-response success is insufficient.
No destination conversation records may be inserted as test fixtures.

## Private configuration

Template strings may use `{{run:apiKey}}`, `{{run:captureToken}}`,
`{{run:userId}}`, `{{run:databasePassword}}`, `{{run:organizationId}}`,
`{{run:organizationSlug}}` and `{{run:projectSlug}}`. Use matching placeholders in
service environment and database credentials. The materializer supplies canonical
hash-only `BOOTSTRAP_CONFIG_B64` and fresh scope IDs. The provider resolves
`{{bootstrap:projectId}}` after committed bootstrap. Runtime JSON can be supplied
privately as `RICH_THREADS_RUNTIME_CONFIG_JSON`.

Per-attempt private files live beside the private template on the durable volume,
outside exported results. Remove them only after verified cleanup. The four logical
bootstrap tables each contain one record for the fresh organization/project/key;
image migration metadata counts require independent verification. Audit content
uses a separate exact bootstrap audit check, never an arbitrary event exemption.

The manual reference comparison is retained separately. The reference was seen
during earlier work, so subsequent results are not blind.
