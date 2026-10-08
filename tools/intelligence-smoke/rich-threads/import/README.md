# Row 3: native import and replay

The framework-neutral probe is `../rows/row3.mjs`. It requires original native
identities, durable complete checkpoints, independently inspected expected
occurrences, and absence in Intelligence before invoking the built CLI. It then
compares ordered text/tool/media payloads, state and pending metadata. Browser
observations and actual pending answers are separate checks; an HTTP success or a
visible button cannot pass them. Repeated complete native call occurrences are
preserved, not deduplicated.

The common Nx runner owns invocation and artifacts:

```sh
RICH_IMPORT_CONFIG=/absolute/owned-config.json pnpm nx run intelligence-smoke:rich-threads -- \
  --framework=mastra \
  --fixture=/absolute/checkout/tools/intelligence-smoke/rich-threads/import/fixtures/completed-native.mjs \
  --baseline=/absolute/baseline.json \
  --output=/absolute/new-output-directory \
  --rows=3
```

Use `strands-typescript` for the second implemented source fixture. Each run needs
a **new namespace** and a new output directory. Other framework identifiers are
accepted by the common runner but do not yet have source adapters here.

## Controlled completed-source fixture

`fixtures/native-sources.mjs` exports `seedMastra` and `seedStrands`. Callers supply
the installed SDK classes, an owned directory, and a unique namespace. Both write
complete paired native turns with user/assistant text, pie/bar chart calls,
an ordinary tool and todo state. Mastra uses LibSQL domain methods; Strands uses
SessionManager's full session checkpoint and verifies an Agent restore roundtrip.
They return original identity, turns, provenance and narrowly selected CLI source
environment. They never run AG-UI or connect the source to Intelligence.

These are **controlled SDK-persisted turns**, not organic provider conversations.
They do not prove provider continuation, genuine native suspension, pending
frontend actionability, media, reasoning, flight cards, A2UI, calculator or MCP.
Those remain unvalidated, not N/A. `completed-native.mjs` fails loudly on content
outside its explicitly supported projection instead of dropping it. The generic
row assertions compare full payloads supplied by richer adapters.

`completed-native.mjs` loads the local JSON path in `RICH_IMPORT_CONFIG`. Required
configuration fields:

- `namespace`: fresh source prefix, using letters, digits, underscores or hyphens.
- `dependencyPackageJson`: absolute package.json used to resolve `pg` and, for
  Mastra, `@mastra/libsql` from pinned existing dependencies.
- `strandsSdk`, `strandsStorage`: absolute compiled SDK and storage module entry
  paths for Strands.
- `databaseUrl`, `organizationId`, `projectId`: explicitly owned destination
  PostgreSQL scope. The fixture reads thread mapping and raw persisted events.
- `cli`, `apiUrl`, `apiKey`, `destinationAgentId`: actual built Intelligence CLI,
  running app-api and owned project runtime credentials. Keep this file private.
- `playwright` and `browser`: optional installed Playwright module entry and
  browser configuration below. Without a working browser configuration the row
  fails at replay and retains source/import evidence; it never reports a pass.

Provision a compatible disposable API/database/gateway/frontend separately using
the common stack owner. This module does not discover services, create containers
or restart anything. It closes only the database client/browser it opens. Native
files and all proof artifacts remain for inspection.

`browser` supplies `url` (optionally containing `{threadId}`), optional `open`
selector, `observations` (`name`, `selector`, optional `attribute`), `expected`
(`name`, `value`) and a `threadId` selector/attribute that reads the selected
Intelligence ID from the actual application. Observations must cover each claimed
visible category. Selectors must target the application's real controls and
content, not an evidence report or a synthetic re-render. Browser assertions
reject historical `/run` requests during replay. `answerInBrowser` captures an
actual click; the fixture must additionally collect both durable stores and the
emitted final response for `assertAnswered`.

## Richer adapters and rows 4–6

Provide `services.importReplay` with `sources`, `inspectNative`, `findImported`,
`importSource`, `readImported`, `replay`, and (for pending sources) `answer`.
`rows/row3.test.mjs` illustrates the data contract with explicitly labeled unit
fixtures. Native inspection and expected data must not call the importer or its
normalizer. Keep full raw checkpoint/session envelopes alongside semantic
projections. Source limitations need detail and evidence; omitted applicable
categories remain unvalidated using the common category list.

Use separate original native sources for mutually exclusive completed/pending
states. Never construct a pending fixture by copying only its assistant call.
Rows 4–6 can reuse the native generators and import wrapper with independent
namespaces. They must retain the original IDs and full pending metadata and must
not reuse a source after row3 has already answered its pending interaction.

`prepare.mjs` now implements the shared onboarding transaction used by row3.
`prepareImportedSources({service,namespace,answerPending:false,writeArtifact})`
returns `{source,native,imported,absentBeforeImport,importEvidence,evidence}`
entries. It validates the source, proves absence, invokes the built CLI, checks
the unique destination and exact imported snapshot, and saves intermediate
evidence even on failure. It never opens or answers pending controls. The
concrete source fixture must allocate a fresh namespace for each consuming row.

API-generated transport message IDs can differ from native tracking IDs. The
completed Strands adapter decodes only the explicit single-block
`native:<JSON tracking ID>:segment:0` representation. Other segment IDs still
fail comparison; raw native envelopes and raw API messages remain in evidence.
This is not a general multi-part message projection.

## Shared-environment driver implementation

`drivers/native-run.mjs` exports `captureNativeRun`. It invokes the actual
Showcase native AG-UI endpoint from `scope.native.endpoints[route]`, using the
complete framework-bound input (including registered frontend tools/context),
and reads the durable store before and after through row2's
`createNativeReader`. It retains original request, raw SSE events, both native
snapshots and errors. A truncated stream, changed thread/run identity or native
run error fails. A genuine interrupted `RUN_FINISHED` is retained unchanged.
This path bypasses Intelligence; it is distinct from the SDK-only builders.

`drivers/content.mjs` independently projects native Mastra parts and complete
Strands messages, then compares them with the Intelligence API wire format.
Text roles, tool arguments/results, repeated occurrences, reasoning, media
bytes/MIME/names and application state remain explicit. Unknown content fails.
Referenced URL/file media requires independently captured bytes; this module
does not fetch native URLs or fill missing names from destination metadata.
The completed-source fixture uses this API projection as well.

These modules are **not full row acceptance**. The common lifecycle must supply
durable native stores and explicit direct endpoints; row2's reader must be
integrated. The shared browser action/snapshot contract, full source catalogue,
real pending response service and full source-factory integration are still
outstanding. Do not treat the planned `import/services.mjs` factory
as implemented. No new staging run has exercised these modules yet.

PNI-605 owns the unresolved approved hosting/access target. PNI-606 owns the
single shared bootstrap, installable dependencies and CI command. Local unit
tests and SDK fixtures do not substitute for staging acceptance. The author has
already seen the temporary comparison reference; subsequent evidence must
disclose that exposure and be collected independently before comparison.
