# Imported rich-thread continuation

Row4 exports the shared `row` runner contract and the pure `verifyContinuation`
assertion. It exercises a follow-up on imported rich history, plus separate
frontend and native pending controls. It never upgrades missing coverage to a
pass. All seven framework names use this same module; fixture services supply
framework-specific inspection and browser actions.

Run through the shared target:

```sh
pnpm nx run intelligence-smoke:rich-threads -- \
  --framework=mastra --rows=4 \
  --fixture=/absolute/fixture.mjs --baseline=/absolute/baseline.json \
  --output=/new/evidence-directory
```

## Concrete driver

`row4/services.mjs` exports the common bootstrap factory `createServices(context)`.
It composes the row3 `import/services.mjs` source/import/readers with the common
Showcase browser and framework capture. It provisions no resources. The common
bootstrap must integrate those sibling modules before this factory can execute.
The older explicit fixture module option below remains useful for unit controls.

The driver opens the imported destination, checks that historical replay produced
no new run, sends a history-dependent follow-up or clicks the original control,
waits for captured terminal events, and rereads both durable stores. SQLite thread
IDs and Strands session directories are inventoried independently. Capture retains actual framework-bound `frameworkRuns: [{input, events, complete}]`
under the original native ID and canonical ingestion events under the Intelligence
ID. The driver uses the common public AG-UI projector with the bootstrap's pinned
`dependencies` to reconstruct messages/state. Ingestion payloads alone cannot
establish which native thread/checkpoint was resumed. Before reading after stores,
the driver waits until all captured canonical event IDs are present durably.
Frontend answers come from submitted tool results; native answers come from
actual resume entries and are bound to the pre-action durable checkpoint.

Row3 preparation uses `prepareImportedSources({answerPending:false,namespace:"row4"})`
and returns `{source,native,imported,plan?}`. A missing plan is derived from native
history: quote the first original user message without including it in the new
prompt, and complete an existing pending todo while preserving other state. Native
pending fixtures must declare their actual control action and expected answer/result.
Raw checkpoint/import/browser/capture observations are written before comparison.

This implementation has unit and real local store-inventory controls. Integration
with the evolving common browser/capture and row3 service modules, approved shared
environment execution, and both-framework acceptance are still required. Local
unit success is not staging acceptance. Prior temporary reference exposure is
recorded; subsequent evidence must not be described as blind.

## Fixture contract

Export `createFixture({framework, outputDir, baseline})`, returning `fixture`,
`services.continuation`, and an owned-resource `cleanup()` function. Services are:

- `sources()`: fresh owned source descriptors, already imported with the real
  CLI. Reuse row3 source builders; use distinct IDs for each row's pending controls.
- `read(source)`: independent durable native and Intelligence snapshots, before
  and after the action. Do not synthesize either store from emitted events.
- `open(source)`: open the exact imported thread in the visible application.
- `followup(source)`: send the history-dependent prompt through that application.
- `resume(source)`: answer the original pending control through that application.

`fromImportedSource(source, native, imported, plan)` reuses row3's native source
and import validation. `plan` supplies `mode` (`followup`, `frontend-pending`, or
`native-pending`), `absentBeforeImport`, `importEvidence`,
`nativeValidationEvidence`, `prompt`, `historyTokens`, `stateChanges`, and
`expectedState`. The absence boolean must come from a retained pre-import query;
import evidence must identify the built CLI and source IDs.

The descriptor retains `nativeItems`, provenance, shared-contract categories,
and the original mapping (`intelligenceId`, `nativeId`, `userId`, `appId`,
`agentId`, `nativeAgentId`, `resourceId`). Intelligence agent mapping can differ
from the native agent; preserve both. Explicit null mappings mean inapplicable,
not unknown. Pending descriptors include original `id`, `callId`, checkpoint
`id` and full metadata, `answer`, and expected `result`.

An item is an ordered occurrence with stable `id`, `kind`, and full `payload`.
Text occurrences have `kind: "text"`, a user/assistant `role`, and string
`payload`. Calls have `kind: "call"` and `payload: {name, arguments}`; results
have `kind: "result"`, original `callId`, and exact result `payload`. Retain
other rich payloads and native sidecars without dropping fields. Decode native
representations into this lossless comparison shape independently of the importer.

Each snapshot returns:

```js
{
  mapping,
  nativeSessionIds, // inventory in the owned user/app/resource scope
  native: { durable: true, evidence, items, state, pending },
  intelligence: { durable: true, evidence, items, state, pending }
}
```

Include newly created empty sessions in the inventory. Proven title-generation
sessions may be described in `after.auxiliarySessions` with `id`,
`purpose: "title-generation"`, original `parentNativeId`, nonempty native
`items`, and retained `evidence`. An unexplained additional session fails.

Actions return `mapping`, `runId`, raw `events`, exact emitted `newItems`, final
emitted `state`, and `browserEvidence`. Resume also returns `resumedId`,
`checkpointId`, and `answer`. Browser evidence must identify the opened thread,
actual submitted prompt/control answer, and screenshot or trace. A button or
HTTP success alone is insufficient. The adapter must await stream completion
and durable-store convergence before returning its after snapshot.

`historyTokens` must originate in imported history/state, be absent from the new
prompt, and appear in the final answer. The source call/result sequence is
validated before grading. State is retained recursively except explicit
`stateChanges` paths; changing a path also requires exact independently specified
`expectedState`. Arrays are compared whole unless a deliberate replacement is
specified. Both stores must retain prior occurrences and append precisely the
emitted user/assistant/result records.

Every applicable category in the shared contract must be covered across valid
sources. Media discriminators and data/url/file variants remain separate. Explicit
N/A entries in `fixture.continuationCoverage` require `category`,
`status: "not-applicable"`, nonempty `detail`, and evidence. Source limitations
must not conceal items that were actually emitted. The `run-error` persistence
category belongs to row1; row4 requires a successful continuation.

Services may throw `ContinuationUnavailable("setup" | "model" | "source", detail)`
only with observed supporting evidence. Setup becomes blocked, model/source
limitations remain unvalidated, and assertion failures remain failed. Evidence
is saved before assertions; failed actions retain diagnostic artifacts.

## Validation status

The assertion suite includes intentional history, state, identity, tool-pairing,
pending-ID, answer/result, coverage, and infrastructure-classification failures.
Unit success does not establish any framework's full parity row.

The October8 PNI-599 independent execution imported controlled native rich
sources on Mastra and Strands TypeScript. Connected continuation was blocked by
an unavailable local PostgreSQL/Docker stack. Separate native diagnostics were
partial and used a different Mastra dependency baseline from the comparison
reference. Full browser continuation, both-store after comparisons, all rich
categories, and live imported pending-control resume remain unvalidated.
