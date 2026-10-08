# Row 6: repeat-import safety

The framework-neutral [row module](../rows/row6.mjs) runs through the shared
`intelligence-smoke:rich-threads` Nx target. Supply a bootstrap module exporting
`createFixture` using the common runner contract:

```sh
pnpm nx run intelligence-smoke:rich-threads -- --framework=mastra --rows=6 --fixture=/absolute/bootstrap.mjs --baseline=/absolute/baseline.json --output=/new/evidence-directory
```

Use the same module for all seven framework names supported by the common
contract. Bootstrap and source adapters own framework differences. Reuse row 3
native source fixtures and their full checkpoint provenance; never generate a
partial pending checkpoint just for this row.

The returned fixture supplies:

- `sourceIds`: nonempty, unique selected native-only source identities.
- `nativeThreadIds`: map from each source ID to its original native thread/session
  ID. Both native IDs and import source identities are checked for absence.
- `continuationSourceIds`: selected rich sources that `continueImported` will
  continue on their original identities.
- `provenance`: source/build/setup description retained in coverage evidence.
- `importSafetyCoverage`: entries `{category, status, evidence, detail}` using
  categories from the common contract, including each media source variant.
  Only observed coverage is `passed`. Unsupported primitives require explicit
  `not-applicable` evidence. Missing coverage keeps the row `unvalidated`.

The bootstrap supplies `services.importSafety`:

| Method                  | Required result                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `snapshotSource()`      | Array of `{sourceId, logical}`. Read complete durable native checkpoints/sessions, messages, state, sidecars, media, pending tasks and workflow metadata. Include all logical tables/files affected by the import.                                                             |
| `snapshotDestination()` | `{threads: [...]}` for **every** thread in the isolated destination scope, not only selected source IDs. Each thread has `{id, sourceId, messages, events, state, ...}`. Preserve complete logical thread/run records in extra fields, raw events, and reconstructed messages. |
| `import()`              | Invoke the same real built importer on each call. Return `{pathIdentity, results}` with `{sourceId, status, destinationId, reason?}` per source. Retain CLI logs/build/command evidence in the fixture output.                                                                 |
| `continueImported()`    | Optional real row-4 continuation action. It must append user and assistant messages to every declared rich source and persist activity in the original native store. Missing action explicitly leaves this scenario unvalidated.                                               |

Import outcomes use `imported`, `skipped`, `conflict`, or `failed`. A selected
source must be `imported` once, then `skipped` with `reason: already_imported`.
Map an unselected already-connected collision to `conflict` with
`reason: IMPORT_NATIVE_ID_CONFLICT`; retain it separately. A conflict must never
be counted as an idempotent selected-source skip. Resolve skipped destination
IDs from the durable mapping if the CLI does not return one.

Snapshots must be stable, ordered logical records. Do not remove timestamps or
metadata that are part of stored history. Database-file bytes and import-batch
audit rows are separate evidence: creating a new batch is expected, rewriting
conversation records is not. Quiesce unrelated writers for the snapshot window.
The module clones each snapshot before later calls, preserves array occurrence
order, compares all fields, and saves exact counts and identities. It freezes a
new baseline after intentional continuation before the final import comparison.

Assertions cover absence, source preservation on initial import, one nonempty
destination per source, exact repeated source/destination equality, identical
built importer identity, continued history retention, and post-continuation
reimport. Row 3 owns initial import fidelity and pending replay/actionability;
row 4 owns semantic continuation proof. This module cannot turn a partial
fixture or a model/setup error into a full parity pass.

The independent PNI-601 execution used the real pinned CLI/API and owned
PostgreSQL/Redis stores. Three controlled Mastra histories and three controlled
Strands TypeScript snapshots imported once and then skipped, with exact logical
source/destination equality. Live rich continuation and full chat-item/source
variant coverage were not independently established. Full row verdict:
**unvalidated**, with the initial/repeat controls passing. The separately read
reference agrees on those controls and contains broader live continuation
coverage; it is not a substitute for running this row's continuation adapter.

## Concrete adapters (delivery in progress)

`native.mjs` reads all logical SQLite tables/schema and native directory files
on every phase. It retains nested array ordering, 64-bit integers, blobs, pending
workflow data and binary sidecars. `destination.mjs` reads every scoped thread,
run, event, state and available replay projection, plus the actual API transcript.
`importer.mjs` invokes the built CLI and reads its durable batch/item outcomes;
`command.mjs` bounds diagnostics, redacts configured credentials and kills its
owned process group on timeout or run cancellation. Import receipts survive
post-command validation failures.

`services.mjs` is the common v2 composition entry point. Its row3 preparation and
row4 continuation bindings are **provisional and not yet integrated**. Required
inputs are an owned clean-scope lifecycle receipt, scoped PostgreSQL pool,
built CLI, row3 source set (selected histories and a real connected collision),
and row4 action on each already-imported rich source. Source entries retain
original native IDs, full checkpoint provenance and continuation plans. The
factory does not provision resources. `collisionSourceIds` requires exactly
those separate conflicts on every import attempt.

The follow-up adapter tests use real temporary SQLite/filesystem stores and
child processes; the destination SQL control uses a test pool. These tests are
supplemental, not Mastra/Strands live acceptance. No fresh coordinated live run
has occurred. PNI-598/599 driver integration and the approved PNI-605 environment
remain required; hosting/access is TBD. Subsequent execution is not blind because
the author has already read the temporary validation reference. Keep the PR draft
until the committed common runner executes both frameworks with full evidence.
