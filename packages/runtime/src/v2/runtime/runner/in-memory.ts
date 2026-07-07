import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
} from "./agent-runner";
import { AgentRunner } from "./agent-runner";
import type { AgentRunnerStopRequest } from "./agent-runner";
import type { Observable } from "rxjs";
import { ReplaySubject } from "rxjs";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunStartedEvent,
  StateSnapshotEvent,
} from "@ag-ui/client";
import { EventType, compactEvents } from "@ag-ui/client";
import { finalizeRunEvents } from "@copilotkit/shared";

export interface InMemoryLimits {
  /** LRU cap on distinct threads. */
  maxThreads?: number;
  /** FIFO cap on runs kept per thread. `Infinity` or `0` disables the cap. */
  maxRunsPerThread?: number;
  /** Total-store byte backstop (approximate). The primary guard. */
  maxBytes?: number;
}

export const ɵINMEMORY_DEFAULTS: Required<InMemoryLimits> = {
  maxThreads: 1000,
  maxRunsPerThread: 100,
  maxBytes: 512 * 1024 ** 2,
};

const EVICTION_GUIDANCE =
  "[CopilotKit] InMemoryAgentRunner evicted in-memory thread history to stay " +
  "under memory limits. This runner is bounded and non-durable by design. For " +
  "durable or production threads, configure an Intelligence backend.";

/**
 * Best-effort approximate byte size of a value, via serialized length.
 * Never throws — returns 0 when the value cannot be serialized. This is an
 * approximation (UTF-16 length, not exact heap bytes), used only for relative
 * accounting against `maxBytes`.
 */
export function ɵestimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

interface HistoricRun {
  threadId: string;
  runId: string;
  /** ID of the agent that executed this run. */
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  /**
   * Snapshot of all messages (input + generated) at the end of this run, as
   * passed in by the caller. NOTE: `BoundedThreadStore.appendRun` moves this
   * snapshot to the THREAD level (`InMemoryEventStore.messagesSnapshot`) and
   * clears this field to `[]`, so a stored HistoricRun never carries messages.
   * The thread-messages fallback reads the thread-level snapshot, not this.
   */
  messages: Message[];
  createdAt: number;
  /** Approximate retained byte size of `events`; set by BoundedThreadStore at append. */
  approxEventBytes?: number;
  /**
   * Legacy field retained for shape compatibility. `appendRun` always zeroes it
   * because message bytes are accounted at the thread level, not per run.
   */
  approxMessageBytes?: number;
}

/**
 * Lightweight thread summary returned by {@link InMemoryAgentRunner.listThreads}.
 * Shape matches the Intelligence platform's ThreadRecord so the same HTTP
 * response envelope can be used for both backends.
 */
export interface InMemoryThread {
  id: string;
  name: string | null;
  agentId: string;
  organizationId: ""; // always empty in in-memory mode
  createdById: ""; // always empty in in-memory mode
  archived: false; // always false in in-memory mode
  createdAt: string;
  updatedAt: string;
}

class InMemoryEventStore {
  constructor(public threadId: string) {}

  /** The subject that current consumers subscribe to. */
  subject: ReplaySubject<BaseEvent> | null = null;

  /** True while a run is actively producing events. */
  isRunning = false;

  /** Current run ID */
  currentRunId: string | null = null;

  /** Historic completed runs */
  historicRuns: HistoricRun[] = [];

  /** Currently running agent instance (if any). */
  agent: AbstractAgent | null = null;

  /** Subject returned from run() while the run is active. */
  runSubject: ReplaySubject<BaseEvent> | null = null;

  /** True once stop() has been requested but the run has not yet finalized. */
  stopRequested = false;

  /** Reference to the events emitted in the current run. */
  currentEvents: BaseEvent[] | null = null;

  /**
   * The thread's single latest NON-EMPTY message snapshot, held at the THREAD
   * level (independent of `historicRuns` lifecycle). Decoupling the snapshot
   * from per-run storage means run-cap FIFO eviction and interleaved
   * empty-snapshot runs can never drop or pin the thread's message history.
   */
  messagesSnapshot: Message[] = [];

  /** Approximate retained byte size of `messagesSnapshot`. */
  approxMessagesSnapshotBytes = 0;
}

export class ɵBoundedThreadStore {
  private readonly map = new Map<string, InMemoryEventStore>();
  private totalBytes = 0;
  private warned = false;

  constructor(private limits: Required<InMemoryLimits>) {}

  get byteTotal(): number {
    return this.totalBytes;
  }

  setLimits(limits: Required<InMemoryLimits>): void {
    this.limits = limits;
  }

  get size(): number {
    return this.map.size;
  }

  /** Re-insert at the tail so Map iteration order stays LRU-first. */
  private touchOrder(threadId: string, store: InMemoryEventStore): void {
    this.map.delete(threadId);
    this.map.set(threadId, store);
  }

  getOrCreate(threadId: string): InMemoryEventStore {
    const existing = this.map.get(threadId);
    if (existing) {
      this.touchOrder(threadId, existing);
      return existing;
    }
    const store = new InMemoryEventStore(threadId);
    this.map.set(threadId, store);
    this.evictThreadsIfNeeded(threadId);
    return store;
  }

  get(
    threadId: string,
    opts: { touch: boolean },
  ): InMemoryEventStore | undefined {
    const store = this.map.get(threadId);
    if (store && opts.touch) this.touchOrder(threadId, store);
    return store;
  }

  peek(threadId: string): InMemoryEventStore | undefined {
    return this.map.get(threadId);
  }

  /**
   * Evict the least-recently-used thread that is neither running NOR
   * mid-finalization. Returns false if none evictable. The `protect` thread
   * (typically the one just created) is never evicted, so a fresh thread is not
   * immediately dropped when it is the only non-running candidate.
   *
   * A thread is skipped while `isRunning` OR `stopRequested` is set.
   * `stop()` flips `isRunning` to false the moment it aborts the agent, but the
   * run keeps finalizing asynchronously (the abort trips the `catch` in
   * `runAgent`, which later calls `appendRun`). During that window
   * `stopRequested` stays true; evicting the thread then would make the pending
   * `appendRun` hit `if (!store) return` and silently drop the aborted run's
   * history. Guarding on `stopRequested` keeps the thread alive until
   * finalization completes.
   */
  private evictOneLru(protect?: string): boolean {
    for (const [threadId, store] of this.map) {
      if (threadId === protect) continue; // never evict the just-created thread
      // never evict a running or still-finalizing (stop-requested) thread
      if (store.isRunning || store.stopRequested) continue;
      this.removeThread(threadId, store);
      this.noteEviction();
      return true;
    }
    return false;
  }

  appendRun(threadId: string, run: HistoricRun): void {
    const store = this.map.get(threadId);
    if (!store) return; // best-effort: nothing to append to

    // Thread-level message snapshot: keep the single latest NON-EMPTY snapshot
    // on the store, decoupled from `historicRuns`. When the incoming run
    // carries a non-empty snapshot, replace the thread's snapshot (adjusting
    // byte accounting). When it's empty (non-array `agent.messages` or an
    // error-path run), leave the existing thread snapshot untouched so history
    // is never lost. The snapshot never lives on a HistoricRun, so run-cap FIFO
    // eviction can never drop it and an interleaved empty run can never pin it.
    if (run.messages.length > 0) {
      this.totalBytes -= store.approxMessagesSnapshotBytes;
      // Store the incoming array directly (SHALLOW, array-level copy). `run.messages`
      // is already a fresh `[...agent.messages]` array created in run(), so we own the
      // array and it is decoupled from `agent.messages` at the array level (push/splice
      // on the agent's array cannot mutate our snapshot). We deliberately do NOT deep-copy
      // here: `structuredClone` throws DataCloneError on a non-cloneable message field,
      // which would wedge the thread and hang SSE — inconsistent with `ɵestimateBytes`,
      // which tolerates the same bad-payload class. The tradeoff is that the inner
      // `Message` objects remain shared by reference with `agent.messages`, so an agent
      // that mutates its own message objects IN PLACE after the run can still be observed
      // through this snapshot. That inner-object isolation is a known limitation tracked as
      // follow-up; callers must treat returned messages as read-only. Estimate bytes on the
      // same value so accounting matches exactly what is retained.
      store.messagesSnapshot = run.messages;
      store.approxMessagesSnapshotBytes = ɵestimateBytes(run.messages);
      this.totalBytes += store.approxMessagesSnapshotBytes;
    }

    // Do not carry message bytes on the HistoricRun: the snapshot is now tracked
    // at the thread level, so historicRuns must never account message bytes.
    run.messages = [];
    run.approxMessageBytes = 0;

    // Compute this run's approximate event size once, at append time.
    run.approxEventBytes = ɵestimateBytes(run.events);
    store.historicRuns.push(run);
    this.totalBytes += run.approxEventBytes;
    this.touchOrder(threadId, store);

    this.enforceRunCap(store);
    this.evictByBytesIfNeeded(threadId);
  }

  private enforceRunCap(store: InMemoryEventStore): void {
    const cap = this.limits.maxRunsPerThread;
    if (!cap || cap === Infinity) return; // 0 or Infinity → disabled
    while (store.historicRuns.length > cap) {
      const dropped = store.historicRuns.shift()!;
      // Only event bytes live on a HistoricRun; the message snapshot is tracked
      // at the thread level and survives run-cap eviction.
      this.totalBytes -= dropped.approxEventBytes ?? 0;
    }
  }

  /**
   * Trim the store back under the byte ceiling by evicting LRU non-running
   * threads. `protect` (the just-appended thread) is never self-evicted, so a
   * fresh run pushes OTHER threads out rather than dropping itself.
   */
  private evictByBytesIfNeeded(protect?: string): void {
    while (this.totalBytes > this.limits.maxBytes) {
      if (!this.evictOneLru(protect)) break; // only protected/running threads left → accept overage
    }
  }

  private removeThread(threadId: string, store: InMemoryEventStore): void {
    for (const run of store.historicRuns) {
      this.totalBytes -= run.approxEventBytes ?? 0;
    }
    // The thread's message snapshot is tracked at the store level, so it must
    // be reclaimed here in addition to the per-run event bytes.
    this.totalBytes -= store.approxMessagesSnapshotBytes;
    this.map.delete(threadId);
  }

  private evictThreadsIfNeeded(protect?: string): void {
    while (this.map.size > this.limits.maxThreads) {
      if (!this.evictOneLru(protect)) break; // everything evictable is running → accept overage
    }
  }

  private noteEviction(): void {
    if (this.warned) return;
    this.warned = true;
    try {
      console.warn(EVICTION_GUIDANCE);
    } catch {
      // best-effort: logging must never break a run
    }
  }

  listThreads(): InMemoryThread[] {
    const threads: InMemoryThread[] = [];
    for (const [threadId, store] of this.map) {
      if (store.historicRuns.length === 0) continue;
      const firstRun = store.historicRuns[0]!;
      const lastRun = store.historicRuns[store.historicRuns.length - 1]!;
      threads.push({
        id: threadId,
        name: null,
        agentId: lastRun.agentId,
        organizationId: "",
        createdById: "",
        archived: false,
        createdAt: new Date(firstRun.createdAt).toISOString(),
        updatedAt: new Date(lastRun.createdAt).toISOString(),
      });
    }
    return threads.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
    this.warned = false;
  }
}

/**
 * Process-wide singleton backing every {@link InMemoryAgentRunner}. Exported
 * (with the `ɵ` internal-API prefix) so tests can inspect the exact store the
 * runner writes to; not part of the public API.
 */
export const ɵGLOBAL_STORE = new ɵBoundedThreadStore(ɵINMEMORY_DEFAULTS);
const sharedStore = ɵGLOBAL_STORE;

export class InMemoryAgentRunner extends AgentRunner {
  readonly ɵsupportsLocalThreadEndpoints = true;

  /**
   * @param limits Optional bounds for the process-global in-memory store. Omit
   * for safe defaults ({@link ɵINMEMORY_DEFAULTS}). When multiple runners are
   * constructed with differing limits, the last-constructed wins — in practice
   * the OSS/SSE default construction passes nothing.
   */
  constructor(limits?: InMemoryLimits) {
    super();
    if (limits) {
      sharedStore.setLimits({ ...ɵINMEMORY_DEFAULTS, ...limits });
    }
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const store = sharedStore.getOrCreate(request.threadId);

    if (store.isRunning) {
      throw new Error("Thread already running");
    }
    store.isRunning = true;
    store.currentRunId = request.input.runId;
    store.agent = request.agent;
    store.stopRequested = false;

    // Track seen message IDs and current run events for this run
    const seenMessageIds = new Set<string>();
    const currentRunEvents: BaseEvent[] = [];
    store.currentEvents = currentRunEvents;

    // Get all previously seen message IDs from historic runs
    const historicMessageIds = new Set<string>();
    for (const run of store.historicRuns) {
      for (const event of run.events) {
        if ("messageId" in event && typeof event.messageId === "string") {
          historicMessageIds.add(event.messageId);
        }
        if (event.type === EventType.RUN_STARTED) {
          const runStarted = event as RunStartedEvent;
          const messages = runStarted.input?.messages ?? [];
          for (const message of messages) {
            historicMessageIds.add(message.id);
          }
        }
      }
    }

    const nextSubject = new ReplaySubject<BaseEvent>(Infinity);
    const prevSubject = store.subject;

    // Update the store's subject immediately
    store.subject = nextSubject;

    // Create a subject for run() return value
    const runSubject = new ReplaySubject<BaseEvent>(Infinity);
    store.runSubject = runSubject;

    // Helper function to run the agent and handle errors
    const runAgent = async () => {
      // Get parent run ID for chaining
      const lastRun = store.historicRuns[store.historicRuns.length - 1];
      const parentRunId = lastRun?.runId ?? null;

      try {
        await request.agent.runAgent(request.input, {
          onEvent: ({ event }) => {
            let processedEvent: BaseEvent = event;
            if (event.type === EventType.RUN_STARTED) {
              const runStartedEvent = event as RunStartedEvent;
              if (!runStartedEvent.input) {
                const sanitizedMessages = request.input.messages
                  ? request.input.messages.filter(
                      (message) => !historicMessageIds.has(message.id),
                    )
                  : undefined;
                const updatedInput = {
                  ...request.input,
                  ...(sanitizedMessages !== undefined
                    ? { messages: sanitizedMessages }
                    : {}),
                };
                processedEvent = {
                  ...runStartedEvent,
                  input: updatedInput,
                } as RunStartedEvent;
              }
            }

            runSubject.next(processedEvent); // For run() return - only agent events
            nextSubject.next(processedEvent); // For connect() / store - all events
            currentRunEvents.push(processedEvent); // Accumulate for storage
          },
          onNewMessage: ({ message }) => {
            // Called for each new message
            if (!seenMessageIds.has(message.id)) {
              seenMessageIds.add(message.id);
            }
          },
          onRunStartedEvent: () => {
            // Mark any messages from the input as seen so they aren't emitted twice
            if (request.input.messages) {
              for (const message of request.input.messages) {
                if (!seenMessageIds.has(message.id)) {
                  seenMessageIds.add(message.id);
                }
              }
            }
          },
        });

        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: store.stopRequested,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the completed run in memory with ONLY its events
        if (store.currentRunId) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);

          sharedStore.appendRun(request.threadId, {
            threadId: request.threadId,
            runId: store.currentRunId,
            agentId: request.agent.agentId ?? "default",
            parentRunId,
            events: compactedEvents,
            // Snapshot all messages (input + generated) for the thread-messages endpoint
            messages: Array.isArray(request.agent.messages)
              ? [...request.agent.messages]
              : [],
            createdAt: Date.now(),
          });
        }

        // Complete the run
        store.currentEvents = null;
        store.currentRunId = null;
        store.agent = null;
        store.runSubject = null;
        store.stopRequested = false;
        store.isRunning = false;
        runSubject.complete();
        nextSubject.complete();
        // Time-scoped release: events are now in historicRuns, so the infinite
        // ReplaySubject buffers are pure duplication — drop them so they become
        // collectable. connect() only subscribes to store.subject while
        // isRunning || stopRequested (both false here), and rebuilds history
        // from historicRuns, so this is safe.
        store.subject = null;
      } catch (error) {
        const interruptionMessage =
          error instanceof Error ? error.message : String(error);
        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: store.stopRequested,
          interruptionMessage,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the run even if it failed (partial events)
        if (store.currentRunId && currentRunEvents.length > 0) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);
          sharedStore.appendRun(request.threadId, {
            threadId: request.threadId,
            runId: store.currentRunId,
            agentId: request.agent.agentId ?? "default",
            parentRunId,
            events: compactedEvents,
            messages: Array.isArray(request.agent.messages)
              ? [...request.agent.messages]
              : [],
            createdAt: Date.now(),
          });
        }

        // Complete the run
        store.currentEvents = null;
        store.currentRunId = null;
        store.agent = null;
        store.runSubject = null;
        store.stopRequested = false;
        store.isRunning = false;
        runSubject.complete();
        nextSubject.complete();
        // Time-scoped release: events are now in historicRuns, so the infinite
        // ReplaySubject buffers are pure duplication — drop them so they become
        // collectable. connect() only subscribes to store.subject while
        // isRunning || stopRequested (both false here), and rebuilds history
        // from historicRuns, so this is safe.
        store.subject = null;
      }
    };

    // Bridge previous events if they exist
    if (prevSubject) {
      prevSubject.subscribe({
        next: (e) => nextSubject.next(e),
        error: (err) => nextSubject.error(err),
        complete: () => {
          // Don't complete nextSubject here - it needs to stay open for new events
        },
      });
    }

    // Start the agent execution immediately (not lazily)
    runAgent();

    // Return the run subject (only agent events, no injected messages)
    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const store = sharedStore.get(request.threadId, { touch: true });
    const connectionSubject = new ReplaySubject<BaseEvent>(Infinity);

    if (!store) {
      // No store means no events
      connectionSubject.complete();
      return connectionSubject.asObservable();
    }

    // Collect all historic events from memory
    const allHistoricEvents: BaseEvent[] = [];
    for (const run of store.historicRuns) {
      allHistoricEvents.push(...run.events);
    }

    // Apply compaction to all historic events together (like SQLite)
    const compactedEvents = compactEvents(allHistoricEvents);

    // Emit compacted events and track message IDs
    const emittedMessageIds = new Set<string>();
    for (const event of compactedEvents) {
      connectionSubject.next(event);
      if ("messageId" in event && typeof event.messageId === "string") {
        emittedMessageIds.add(event.messageId);
      }
    }

    // Bridge active run to connection if exists
    if (store.subject && (store.isRunning || store.stopRequested)) {
      store.subject.subscribe({
        next: (event) => {
          // Skip message events that we've already emitted from historic
          if (
            "messageId" in event &&
            typeof event.messageId === "string" &&
            emittedMessageIds.has(event.messageId)
          ) {
            return;
          }
          connectionSubject.next(event);
        },
        complete: () => connectionSubject.complete(),
        error: (err) => connectionSubject.error(err),
      });
    } else {
      // No active run, complete after historic events
      connectionSubject.complete();
    }

    return connectionSubject.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    const store = sharedStore.peek(request.threadId);
    return Promise.resolve(store?.isRunning ?? false);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const store = sharedStore.peek(request.threadId);
    if (!store || !store.isRunning) {
      return Promise.resolve(false);
    }
    if (store.stopRequested) {
      return Promise.resolve(false);
    }

    store.stopRequested = true;
    store.isRunning = false;

    const agent = store.agent;
    if (!agent) {
      store.stopRequested = false;
      store.isRunning = false;
      return Promise.resolve(false);
    }

    try {
      agent.abortRun();
      return Promise.resolve(true);
    } catch (error) {
      console.error("Failed to abort agent run", error);
      store.stopRequested = false;
      store.isRunning = true;
      return Promise.resolve(false);
    }
  }

  /**
   * Returns a summary of every thread that has been run through this runner.
   *
   * This powers the local-dev fallback for `GET /threads` when the Intelligence
   * platform is not configured. Each entry mirrors the shape of a platform
   * `ThreadRecord` so the HTTP handler can use the same response envelope.
   */
  listThreads(): InMemoryThread[] {
    return sharedStore.listThreads();
  }

  /**
   * Returns all messages for a thread, using the snapshot captured at the end
   * of the most recent run.
   *
   * This powers the local-dev fallback for `GET /threads/:threadId/messages`
   * when the Intelligence platform is not configured. The returned `Message[]`
   * objects come directly from the ag-ui agent, so their shape is compatible
   * with the Intelligence platform's `ThreadMessage` type.
   */
  getThreadMessages(threadId: string): Message[] {
    const store = sharedStore.peek(threadId);
    if (!store) return [];
    // The thread's latest non-empty snapshot is held at the store level,
    // independent of `historicRuns` lifecycle, so run-cap eviction and
    // interleaved empty-snapshot runs can never lose it. Return a SHALLOW
    // (array-level) copy: a fresh array so a caller mutating array STRUCTURE
    // (push/splice/reassign elements) cannot affect the stored snapshot. We
    // deliberately do NOT deep-copy: `structuredClone` throws DataCloneError on a
    // non-cloneable message field, which would wedge the thread and hang SSE —
    // inconsistent with `ɵestimateBytes`, which tolerates the same bad-payload class.
    // The tradeoff is that the inner `Message` objects remain shared by reference with
    // the stored snapshot, so mutating a returned message's FIELD
    // (e.g. `getThreadMessages(t)[0].content = "x"`) is NOT isolated and would corrupt
    // the stored snapshot. That inner-object isolation is a known limitation tracked as
    // follow-up; callers must treat returned messages as read-only.
    return [...store.messagesSnapshot];
  }

  /**
   * Returns all AG-UI events for a thread, compacted across historic runs.
   *
   * Powers the local-dev fallback for `GET /threads/:threadId/events` when the
   * Intelligence platform is not configured. The compaction logic matches
   * the connection-replay path in {@link connect}, so the stream a
   * late-joining inspector sees matches what this method returns.
   */
  getThreadEvents(threadId: string): BaseEvent[] {
    const store = sharedStore.peek(threadId);
    if (!store || store.historicRuns.length === 0) return [];
    const all: BaseEvent[] = [];
    for (const run of store.historicRuns) all.push(...run.events);
    return compactEvents(all);
  }

  /**
   * Returns the agent state snapshot for a thread.
   *
   * Derived from the last `STATE_SNAPSHOT` in the compacted event stream. The
   * AG-UI `compactEvents` helper consolidates STATE_DELTA events and produces
   * a single trailing STATE_SNAPSHOT when state changes exist, so this is a
   * faithful view of state at the end of the most recent run.
   *
   * Returns `null` when the thread has never emitted a STATE_SNAPSHOT.
   */
  getThreadState(threadId: string): Record<string, unknown> | null {
    const events = this.getThreadEvents(threadId);
    // Walk backwards — the last snapshot wins.
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.type === EventType.STATE_SNAPSHOT) {
        const snapshot = (event as StateSnapshotEvent).snapshot;
        // Only plain objects satisfy the Record<string, unknown> contract.
        // `typeof [] === "object"` is true, so arrays must be rejected
        // explicitly to avoid returning an array typed as a Record.
        if (
          snapshot &&
          typeof snapshot === "object" &&
          !Array.isArray(snapshot)
        ) {
          // Return a defensive shallow copy so callers can't mutate the
          // snapshot object held inside the stored event (matches the
          // getThreadMessages defensive-copy approach).
          return { ...(snapshot as Record<string, unknown>) };
        }
        return null;
      }
    }
    return null;
  }

  /**
   * Clears all in-memory thread history.
   *
   * Powers the local-dev fallback for `POST /threads/clear`, letting consumers
   * (e.g. the demo's Clear button) reset to an empty thread list without
   * restarting the runtime. Intentionally not exposed on the Intelligence
   * platform path: there, thread history lives in a real database and must
   * not be wiped this way.
   */
  clearThreads(): void {
    sharedStore.clear();
  }
}
