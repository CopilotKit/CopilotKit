# Rich-thread row runner

This runner extends the existing Intelligence smoke suite with one row-module
interface. The existing Thread/Learning smoke remains separate. A passing unit
suite is **not** a rich-thread parity verdict.

```sh
pnpm nx run intelligence-smoke:test
pnpm nx run intelligence-smoke:lint
pnpm nx run intelligence-smoke:rich-threads -- \
  --framework=mastra --rows=1 \
  --fixture=/absolute/path/to/fixture.mjs \
  --baseline=/absolute/path/to/baseline.json \
  --output=/new/owned/evidence-directory
```

Framework IDs are `langgraph-python`, `langgraph-fastapi`, `langgraph-js`, `adk`,
`mastra`, `strands-python`, and `strands-typescript`. Row modules are
`rows/row1.mjs` through `rows/row6.mjs`. An absent selected module fails; it is
never silently skipped. Each module exports `row = { id, title, run(context) }`.
This change supplies row 1; the other rows have separate owners.

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
media bytes/metadata. The live runner requires a real fixture bootstrap; this
change does not ship seven complete backend/browser drivers or claim full
seven-framework E2E coverage. Do not run a synthetic fixture in CI and label its
result as product parity. Retain live output directories as CI artifacts when a
real fixture is provisioned. Missing coverage must remain visible.
