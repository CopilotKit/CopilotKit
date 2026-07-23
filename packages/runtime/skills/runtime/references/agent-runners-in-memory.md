InMemoryAgentRunner — default ephemeral runner. Keyed on a `globalThis` Symbol so thread state survives hot-module reloads during development.

## Store layout

```typescript
// packages/runtime/src/v2/runtime/runner/in-memory.ts
const GLOBAL_STORE_KEY = Symbol.for("@copilotkit/runtime/in-memory-store");

interface GlobalStoreData {
  stores: Map<string, InMemoryEventStore>; // per-threadId
  historicRunsBackup: Map<string, HistoricRun[]>; // restored after HMR
}
```

One `InMemoryEventStore` per `threadId`. Each store tracks:

- `subject: ReplaySubject<BaseEvent> | null` — current consumers
- `isRunning: boolean` — gate for the `"Thread already running"` throw
- `currentRunId: string | null`
- `historicRuns: HistoricRun[]` — completed runs (backed up across HMR)
- `agent: AbstractAgent | null` — the instance that owns the active run
- `runSubject`, `currentEvents`, `stopRequested`

## Lifecycle

1. `run({ threadId, agent, input })` — if `store.isRunning` throw `Error("Thread already running")`. Otherwise create a `ReplaySubject`, subscribe to `agent.run(input)`, push events into the subject, track them in `currentEvents`, mark the store `isRunning`.
2. On `RunFinishedEvent` / `RunErrorEvent`: finalize the run, push its events into `historicRuns`, clear `isRunning`, `currentRunId`, `agent`.
3. `connect({ threadId })` — returns a `ReplaySubject` that replays the active run events or (if no active run) the most recent historic run.
4. `stop({ threadId })` — sets `stopRequested = true`; the active subscription checks the flag on each event and tears down.

## Hot reload (development)

In dev, bundlers replace modules. `GLOBAL_STORE_KEY` uses `Symbol.for(...)` so the same well-known symbol is reused across module instances — `globalThis[KEY]` survives. On module re-evaluation, if the `stores` map is empty but `historicRunsBackup` still has entries, the runner rehydrates historic-only stores from the backup (active runs are lost, historic runs come back).

## When NOT to use

- Multi-instance production deploys — each process has its own store.
- Long-lived servers — restart wipes active threads (historic runs are only preserved in the HMR-dev backup, not across process exit).
- Load-balanced serverless with cold starts — new workers see empty stores.

## When it is OK

- Local development.
- Single-instance preview environments.
- Tests (each `new InMemoryAgentRunner()` still shares the globalThis store — pass a fresh threadId per test, or clear the captured store in place between tests). Do NOT `delete globalThis[Symbol.for("@copilotkit/runtime/in-memory-store")]`: `in-memory.ts:98` captures `GLOBAL_STORE = getGlobalStore()` as a module-level const referencing the inner `stores` Map, so replacing `globalThis[KEY]` creates a new object that the module no longer consults. Mutate the existing maps in place:

  ```ts
  // test setup
  const storeKey = Symbol.for("@copilotkit/runtime/in-memory-store");
  const data = (globalThis as any)[storeKey] as
    | {
        stores: Map<string, unknown>;
        historicRunsBackup: Map<string, unknown>;
      }
    | undefined;
  if (data) {
    data.stores.clear();
    data.historicRunsBackup.clear();
  }
  ```

  The runtime does not yet expose an official reset helper — a `__TEST_ONLY_clearGlobalStore` export would be a reasonable follow-up.

Source: `packages/runtime/src/v2/runtime/runner/in-memory.ts`.
