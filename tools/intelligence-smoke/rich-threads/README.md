# Rich-thread row runner

This runner extends the existing Intelligence smoke suite with one row-module
interface. The existing Thread/Learning smoke remains separate. A passing unit
suite is **not** a rich-thread parity verdict.

```sh
pnpm nx run intelligence-smoke:rich-threads-setup
pnpm nx run intelligence-smoke:rich-threads-test
pnpm nx run intelligence-smoke:rich-threads-driver-test
pnpm nx run intelligence-smoke:lint
pnpm nx run intelligence-smoke:rich-threads -- \
  --framework=mastra,strands-typescript --rows=1,2 \
  --config=/absolute/path/to/private-environment.json \
  --output=/new/owned/evidence-directory
```

Framework IDs are `langgraph-python`, `langgraph-fastapi`, `langgraph-js`, `adk`,
`mastra`, `strands-python`, and `strands-typescript`. Row modules are
`rows/row1.mjs` through `rows/row6.mjs`. An absent selected module fails; it is
never silently skipped. Each module exports `row = { id, title, run(context) }`.
The concrete bootstrap currently supports Mastra and Strands TypeScript; naming
the other five frameworks in the contract does not implement them.

## Committed browser bootstrap

`--config` loads `bootstrap.mjs`; no external executable fixture is required.
It creates one lifecycle environment, verifies empty durable stores/queues, runs
frameworks and rows serially, then cleans up. Config follows
[`lifecycle/README.md`](lifecycle/README.md), plus `redisUrl`, optional exact
bootstrap-table allowances, and an optional `dependenciesDirectory` (defaults to
the locked `dependencies/` folder). Keep this file private: it contains keys and
database connection strings. Each scope needs `capture.store`, with the runtime
writing that same mounted directory. `suite.json` reports harness execution
separately from product verdicts.

`runtime.mjs` reads `RICH_THREADS_RUNTIME_CONFIG`. That private JSON specifies
`captureDirectory`, `apiUrl`, `gatewayUrl`, `apiKey`, `mcpServers`, and `scopes`.
Each runtime scope specifies `framework`, `agentId`, `userId`, `injectA2UITool`,
and `routes`, a map of mode names to native HTTP endpoints. Required modes are
`rich`, `reasoning`, `state`, `media`, `native-suspend`, plus Mastra
`native-approval`. Every mode also has a source-only route without Intelligence,
used to create original native histories before import. Native-only captures
are never presented as connected persistence evidence.

`application/page.tsx` imports a single existing Beautiful Chat implementation,
adds the real threads drawer, and renders native interrupt decisions. Browser
drivers submit through that UI, await `beforeRun(input)` before allowing a POST,
and retain screenshots plus observed chart/frame/media/control surfaces.

`rich-threads-prepare -- --output=<new-directory> --pins=<pins.json>` stages
committed Showcase/application sources and generates an installable lockfile.
Pins map package names to exact registry versions or `{path,sha256}` candidate
tarballs; tarball bytes are checked before staging. The staged Dockerfile builds
one application/runtime/Mastra image. Runtime command:
`node /app/rich-threads/runtime.mjs`. Mastra command:
`node --import tsx /app/rich-threads/row2/mastra-backend.mjs`, with
`RICH_THREADS_MASTRA_SOURCE=/app/src/mastra/index.ts` and
`TSX_TSCONFIG_PATH=/app/tsconfig.json`. Use row2's durable-store environment
bindings. Strands uses its actual Showcase server and durable session wrapper.

`application/package-pins.json` records the public package baseline used for
the application compile check. It pins the Inspector and its core dependency
together; pinning only the top-level React packages can install incompatible
nested versions. This is a development baseline, not evidence that a candidate
source build ran. Preparation freezes one Git revision for all staged files.
To inspect the prepared application locally, use
`rich-threads-app -- --directory=<prepared-directory> --port=<owned-port>` and
set `RICH_THREADS_RUNTIME_URL` to the owned runtime URL.

Capture records the exact native input/events before runtime middleware and the
canonical Phoenix payload before ingestion. Exact-ID retries retain a separate
attempt log. The durable reader independently reads scoped SQL rows and the
public transcript API. Only gateway-added `organization_id` and
`metadata.cpki_ingested` are removed after validation; complete raw rows remain
in the saved artifact. Message/state projection uses the pinned public AG-UI
consumer, not the Intelligence transcript implementation.

## Fixture bootstrap

A fixture module exports `async createFixture({ framework, outputDir, baseline })`
and returns `{ fixture, services, cleanup }`. Backend-specific wiring belongs in
this fixture, not in the common assertions. Create isolated users, thread IDs,
durable stores and services. Never reuse a developer's active test database.
Cleanup must stop only resources created by that fixture. A bootstrap that
throws before returning must clean up its own partially created resources.

The row context is `{ framework, fixture, services, baseline, outputDir,
writeArtifact }`. Each row receives a separate `rowN/` output directory.
`writeArtifact(relativeName, value)` writes JSON without overwriting evidence.
Screenshots should also live under that row's output directory. Fixture services
must use bounded requests and redact credentials from diagnostics. Do not put
credentials in `baseline`, fixtures written as evidence, or exception messages.

Baseline JSON requires `sources` with full `copilotkit`, `intelligence`, and
`agUi` Git SHAs, `packages` mapping installed package names to versions, and
`fixtureProvenance` describing how inputs were made. Add artifact hashes and
explicit source/build differences: a checked-out SHA does not establish which
binary ran, and the same package version can contain different local builds.

A row returns `{ status, checks, limitations }`. Each check includes `name`,
`status`, `evidence` paths and `detail`. Statuses are `passed`, `failed`,
`blocked`, `unvalidated`, and `not-applicable` for checks. The common runner
recomputes aggregate status and rejects contradictory row verdicts. An empty
check list or all-N/A checks cannot establish a pass. Setup, cleanup and row
failures retain `result.json`; setup failures are blocked, cleanup failures fail.

## Row 1 service boundary

`fixture.row1` contains:

- `scenarios`: `{ id, categories }` entries, using the category IDs in
  `contract.mjs`. Several fresh conversations can cover mutually exclusive
  pending/completed controls or provider-incompatible attachments.
- `applicability`: optional category entries `{ status: "not-applicable",
reason, evidence }`. Supply actual capability/source evidence. Missing
  categories default to unvalidated.
- `limitations`: fixture/provider/build qualifications.

`services.row1.runFresh(scenario)` must drive the actual shared browser UI and
connected runtime/framework path. Return:

```js
{
  emitted: {
    threadId, agentId, userId, runIds,
    events, messages, state, pending
  },
  browser: { fresh: true, url, screenshots, interactions },
  witnesses: [{ category, pointer }],
  media: [{ pointer, type, sourceType, mimeType, filename, sha256 }]
}
```

Capture events before persistence, and reconstruct expected messages/state from
that independent stream. Prove fresh identities in the driver before starting.
Do not obtain expectations from the saved destination or inject destination
records. JSON pointers identify actual emitted values under `/events`,
`/messages`, `/state`, or `/pending`. Witnesses are fixture-specific and must
point to the named chat item, not an unrelated string. Category labels alone
cannot replace attachment-byte verification.

`services.row1.readSaved(emitted)` independently reads raw Intelligence events
and the public reconstructed transcript, returning the same logical envelope.
It may poll for durable writes within a finite timeout. Preserve full payloads
and array ordering. Unwrap transport/database envelopes, but do not discard
payload fields, sort occurrences, reassign IDs, or normalize away differences.
Represent pending frontend calls separately from native interrupt identities.

For each attachment, compare against an independently computed original SHA-256
and original filename/MIME. Current AG-UI parts carry `source.value`,
`source.mimeType`, and `metadata.filename`. URL/file source fixtures must also
return `saved.resolvedMedia[pointer]` containing base64 read from the **saved** durable reference; a matching
URL alone does not prove durable bytes.

Completed frontend/native controls and calculator interaction require a browser
interaction record `{ category, controlId, action, identityPointer }` linking
the visible action to its original emitted control identity. Fixtures must
supply `toolCallId`, `callIdPointer`, `resultPointer`, and `responsePointer` for completed controls. The result and response pointers address whole `/messages/N` entries: a result for that call followed by a nonempty assistant reply. Supply completed answer witnesses and separate pending
scenarios. A screenshot is retained evidence, not proof of actionability by
itself.

Row 1 compares every emitted event, message, state field and pending entry
exactly. Saved `RUN_ERROR` events remain valid evidence. Requested items never
emitted are coverage gaps; browser/setup failures and persistence differences
have separate `layer` labels. No row-1 result proves native persistence, import,
continuation, restart or repeat-import safety.

## Current scope and CI

The existing Intelligence smoke workflow invokes `intelligence-smoke:test`, which
now includes the row-module and runner failure controls. They deliberately alter
order, counts, tool associations, chart values, state fields, pending IDs and
media bytes/metadata. The separate driver controls launch real Chromium against
a small local control page; they validate browser wiring, not Showcase parity.
Live execution still requires installable candidate images and a complete private
launch configuration. The approved hosting/access decision remains unresolved.
The six-row source/import/continuation composition, URL/file media resolvers,
and full seven-framework acceptance remain incomplete. Do not label unit or
driver controls as product parity. Retain live output directories when an owned
environment can actually run; missing coverage stays visible.

The manual `intelligence-rich-threads.yml` workflow requests Mastra and Strands
TypeScript with all six rows, serializes runs, and retains ownership receipts
and results after attempting interrupted-run recovery. It has not been
dispatched or provisioned. Its `intelligence-rich-threads-development` GitHub
environment requires a private `RICH_THREADS_CONFIG_JSON` launch manifest.
The hosting/access/budget decision and complete launch bindings (including
migrations and missing row service factories) remain prerequisites; the job
fails instead of substituting fixtures. No periodic schedule is enabled.
