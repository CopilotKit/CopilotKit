# Row 5: reload and owned backend restart

The shared runner loads [row5.mjs](../rows/row5.mjs) with `--rows=5`. The probe is identical for all seven framework names. Framework-specific native inspection and browser actions belong in the fixture bootstrap supplied with `--fixture`.

```sh
pnpm nx run intelligence-smoke:rich-threads -- \
  --framework=mastra --rows=5 \
  --fixture=/absolute/path/to/bootstrap.mjs \
  --baseline=/absolute/path/to/baseline.json \
  --output=/new/evidence/directory
```

This module is an assertion/lifecycle contract, not a complete live fixture implementation. Unit fixtures are not framework validation. A missing browser, native store, import path or applicable category must remain unvalidated; an unavailable stack is a setup blocker.

## Bootstrap contract

Export `createFixture({ framework, outputDir, baseline })` returning `{ fixture, services, cleanup }`. The shared runner calls `cleanup()` even when assertions fail. Release only resources created by that bootstrap. `fixture.row5.owner` is the unique run ownership token. Put the methods below on `services.row5`:

| Method                                       | Required behavior                                                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare()`                                  | Execute fresh connected scenarios and import independently verified native-only histories. Return scenario descriptors. Never insert destination records to imitate execution or import. |
| `read(scenario)`                             | Independently read Intelligence and the complete native durable store envelope. Return a detached semantic snapshot.                                                                     |
| `open(scenario, { reload, phase })`          | Reopen the original thread in the real application, actually reload when requested, and return observed browser items/state/controls, identity and evidence paths.                       |
| `expectedBrowser(scenario, snapshot, phase)` | Produce the independently specified renderer projection for comparison. Never return observed DOM as expected output.                                                                    |
| `restart()`                                  | Stop/start explicitly owned API, gateway, application runtime and native backend against the same stores; await readiness and return restart receipts.                                   |
| `respond(scenario, { interactionId })`       | Answer the original pending control through the loaded application and await saved result/final response. The fixture must use approval scenarios that retain shared state.              |
| `followup(scenario)`                         | Send a history-dependent normal follow-up through the original application thread; return independently specified `{ userItem, assistantItem, state }` for both-store comparisons.       |

A descriptor has a safe lowercase `id`, `origin` (`fresh` or `imported`), `kind` (`rich`, `frontend-pending`, `frontend-completed`, `native-pending`, `native-completed`), fixture `provenance`, and `interactionId` for control cases. Prepare all ten combinations. Separate histories are expected for mutually exclusive pending/completed states.

`coverage` entries use `{ item, status, evidence, detail }`. `item` is a category from [contract.mjs](../contract.mjs), including every applicable media discriminator/source variant. `status: "exercised"` requires actual artifact paths. `"not-applicable"` requires paths and an evidence-backed explanation. Missing combinations/categories produce explicit unvalidated checks. Evidence must describe the emitted source and fixture limitations; chart-shaped JSON alone does not establish chart rendering, and copied messages alone do not establish native pause actionability.

## Snapshot and browser projection

```js
{
  identity: { intelligenceThreadId, nativeThreadId, userId, agentId },
  intelligence: { items, state, controls },
  native: { items, state, controls }
}
```

`items` is the complete ordered semantic history. Retain all message/call IDs, arguments/results, state fields, media bytes/MIME/original filenames, UI operations and resource references. Native adapters inspect sidecars/checkpoint metadata, not just display text. Remove only documented volatile read metadata; never filter missing or unsupported content to manufacture equality. Include relevant app/resource mapping in `identity` as extra fields; the entire identity object is compared.

Controls have `{ id, kind, status, payload, result?, finalResponse? }`, where `kind` is `frontend` or `native`. Completed controls require a result and final response; resumed controls must retain their ID/payload, clear pending state, preserve previous history/state and save the final response in both histories. Normal follow-up snapshots must append both expected message roles to each store, retain prior history and match the expected state.

Browser observations have `{ identity, items, state, controls, evidence }`; `evidence` names screenshots or action records. The fixture's expected projection must include every applicable visible item/control and its completed/pending state. API reads cannot substitute for this method.

## Restart ownership

A receipt has `{ service, role, owner, before: { instance, store }, after: { instance, store }, ready }`. Required roles are `intelligence-api`, `intelligence-gateway`, `application-runtime`, and `native-backend`. Incarnations must change, durable store identifiers must remain identical, and readiness must succeed. Store identifiers must not contain credentials. A database-server restart is additional coverage, not required by this contract.

[ownedProcess](../rows/row5-process.mjs) creates and retains its own child handles, bounds readiness/shutdown and returns receipts. Its readiness callback receives the child PID/incarnation and should verify the owned endpoint. It never accepts an arbitrary PID or discovers global services. Container fixtures should similarly verify labels and immutable container identity before any restart. Never restart a shared daemon or staging service.

The row retains pre-reload, post-reload, post-restart, resumed/continued and final-reload snapshots plus browser evidence and restart receipts. A failed assertion leaves earlier artifacts intact. Review partial artifacts together with the overall report; no individual equality check establishes the full row.
