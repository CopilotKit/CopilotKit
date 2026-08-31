InMemoryAgentRunner — default ephemeral runner. Thread state lives in a bounded, process-global store shared by every runner instance in the process.

## Store layout

```typescript
// packages/runtime/src/v2/runtime/runner/in-memory.ts
export const ɵGLOBAL_STORE = new ɵBoundedThreadStore(ɵINMEMORY_DEFAULTS);
```

`ɵBoundedThreadStore` owns the `Map<threadId, InMemoryEventStore>`, LRU ordering, byte accounting, and eviction. The runner keeps all streaming logic and delegates storage to the store. The `ɵ` prefix marks internal API — exported for tests, not part of the public surface.

One `InMemoryEventStore` per `threadId`. Each store tracks:

- `subject: ReplaySubject<BaseEvent> | null` — current consumers; released on run completion
- `isRunning: boolean` — gate for the `"Thread already running"` throw
- `currentRunId: string | null`
- `historicRuns: HistoricRun[]` — completed runs (events only; see snapshot note below)
- `messagesSnapshot: Message[]` — the thread's latest non-empty message snapshot, held at the THREAD level so run-cap eviction can never drop it
- `agent: AbstractAgent | null` — the instance that owns the active run
- `runSubject`, `currentEvents`, `stopRequested`

## Bounds

Three limits, whichever trips first. Defaults in `ɵINMEMORY_DEFAULTS`:

| Option             | Default | Enforcement                                                    |
| ------------------ | ------- | -------------------------------------------------------------- |
| `maxThreads`       | `1000`  | LRU eviction of the least-recently-used thread                 |
| `maxRunsPerThread` | `100`   | FIFO drop of oldest runs; `Infinity` or `0` disables           |
| `maxBytes`         | 512 MiB | Approximate total across all threads; evicts OTHER LRU threads |

```typescript
new InMemoryAgentRunner({
  maxThreads: 200,
  maxRunsPerThread: 50,
  maxBytes: 128 * 1024 ** 2,
});
```

Invariants worth knowing before touching this code:

- A thread is never evicted while `isRunning` **or** `stopRequested` is set. `stop()` flips `isRunning` false immediately but the run finalizes asynchronously; evicting in that window would make the pending `appendRun` silently drop history.
- `maxBytes` only bounds **committed** history. A single in-flight run's buffered events are not counted until the run completes, so it does not bound one runaway run mid-stream.
- `maxBytes` evicts other threads and never self-evicts the just-appended thread — it is a cross-thread ceiling, not a per-thread cap. A single dominant thread is bounded by `maxRunsPerThread`.
- Byte accounting is a `JSON.stringify().length` estimate, not exact heap bytes.
- Two eviction forms, both steering heavy users to an Intelligence backend via one shared warn-once latch. Whole-thread eviction (`maxThreads` count or `maxBytes` ceiling) drops the entire LRU thread — it stops appearing in `GET /threads`. Per-thread `maxRunsPerThread` trimming drops only a thread's oldest runs' events, keeping the thread visible with its original `createdAt` and its thread-level `messagesSnapshot`. The latch fires **once per store** (not once per eviction), reset only by `clearThreads()`/`clear()`, so a hot thread trimming on every append logs a single line and every later eviction is silent until a clear.

## Concurrency

`onConcurrentRun` is per-runner (unlike the limits, which are process-global):

- `"throw"` (default) — a second `run()` on a live thread throws `Error("Thread already running")`.
- `"supersede"` — aborts the in-flight run (same path as `stop()`) and starts the new one. The superseded run's teardown is guarded on `store.currentRunId === request.input.runId` (so it cannot push history under the new run's id or reset the new run's state) and on `store.subject === nextSubject` (so releasing its ReplaySubject cannot null out the live run's subject).

## Lifecycle

1. `run({ threadId, agent, input })` — `sharedStore.getOrCreate(threadId)` (may evict other threads), then throw or supersede per `onConcurrentRun`. Create `ReplaySubject`s, run the agent, push events into the subjects and `currentEvents`, mark `isRunning`.
2. On completion or error: finalize, `sharedStore.appendRun(...)` with the compacted events (which enforces the run cap and byte ceiling), clear `isRunning` / `currentRunId` / `agent`, and release `store.subject` so the infinite ReplaySubject buffer becomes collectable. History is rebuilt from `historicRuns` afterwards.
3. `connect({ threadId })` — replays compacted `historicRuns`, then bridges the live subject while `isRunning || stopRequested`.
4. `stop({ threadId })` — sets `stopRequested = true`, aborts the agent; teardown runs in the run's `catch`.

## Config scope gotcha

Limits reconfigure the shared store, so the **last-constructed runner wins for all in-memory threads**. A second runner passing limits that differ from an already-customized store logs a one-time clobber warning. Passing only `onConcurrentRun` leaves the limits untouched.

## When NOT to use

- Multi-instance production deploys — each process has its own store.
- Anywhere history loss is unacceptable — eviction is history loss, same as a restart.
- Load-balanced serverless with cold starts — new workers see empty stores.

## When it is OK

- Local development.
- Single-instance preview environments.
- Production single-instance deploys where scrollback is best-effort — the bounds make this safe against OOM, not durable.
- Tests. Every `new InMemoryAgentRunner()` shares the same store, so use a fresh `threadId` per test or call `runner.clearThreads()` (which resets the map, byte total, and eviction warn latch) between tests. Tests that customize limits must restore them: `new InMemoryAgentRunner(ɵINMEMORY_DEFAULTS)` in an `afterEach` — a no-arg construction is inert and will NOT restore defaults.

Source: `packages/runtime/src/v2/runtime/runner/in-memory.ts`.
