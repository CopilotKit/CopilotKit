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

interface HistoricRun {
  threadId: string;
  runId: string;
  /** ID of the agent that executed this run. */
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  /**
   * Snapshot of all messages (input + generated) at the end of this run.
   * Used by the local thread-messages fallback endpoint.
   */
  messages: Message[];
  createdAt: number;
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
}

const GLOBAL_STORE = new Map<string, InMemoryEventStore>();

export class InMemoryAgentRunner extends AgentRunner {
  readonly ɵsupportsLocalThreadEndpoints = true;

  /**
   * How to handle a `run()` for a thread that already has an in-flight run.
   * `"throw"` (default) preserves the historic behavior. `"supersede"` aborts
   * the prior run (mirroring `stop()`) and starts the new one — opted into by
   * the hosted-bot listener so a fast follow-up turn on the same thread cleanly
   * replaces a still-running (or wedged) prior turn instead of erroring with
   * "Thread already running".
   */
  private readonly onConcurrentRun: "throw" | "supersede";

  constructor(options?: { onConcurrentRun?: "throw" | "supersede" }) {
    super();
    this.onConcurrentRun = options?.onConcurrentRun ?? "throw";
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    let existingStore = GLOBAL_STORE.get(request.threadId);
    if (!existingStore) {
      existingStore = new InMemoryEventStore(request.threadId);
      GLOBAL_STORE.set(request.threadId, existingStore);
    }
    const store = existingStore; // Now store is const and non-null

    if (store.isRunning) {
      if (this.onConcurrentRun !== "supersede") {
        throw new Error("Thread already running");
      }
      // Supersede: abort the prior (possibly wedged) run so this one can start.
      // Mirrors stop(). The prior run's async finalization runs later and is
      // prevented from clobbering this run's state by the run-id guard below.
      const priorAgent = store.agent;
      store.stopRequested = true;
      store.isRunning = false;
      if (priorAgent) {
        try {
          priorAgent.abortRun();
        } catch (error) {
          console.error("Failed to abort superseded run", error);
        }
      }
      store.stopRequested = false;
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

        // Store the completed run in memory with ONLY its events. Guard on the
        // per-run id (not the shared `store.currentRunId`): a superseded run no
        // longer owns the store, so it must not push history — and never under
        // a newer run's id, which would corrupt the thread's history.
        if (store.currentRunId === request.input.runId) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);

          store.historicRuns.push({
            threadId: request.threadId,
            runId: request.input.runId,
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

        // Complete the run. Guard the shared-store reset: if a newer run has
        // superseded this one (`currentRunId` changed), that run now owns the
        // store — don't clobber its state. Always complete THIS run's subjects.
        if (store.currentRunId === request.input.runId) {
          store.currentEvents = null;
          store.currentRunId = null;
          store.agent = null;
          store.runSubject = null;
          store.stopRequested = false;
          store.isRunning = false;
        }
        runSubject.complete();
        nextSubject.complete();
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

        // Store the run even if it failed (partial events). Same per-run guard:
        // a superseded run's error teardown must not push history under the
        // newer run's id (see success-path note).
        if (
          store.currentRunId === request.input.runId &&
          currentRunEvents.length > 0
        ) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);
          store.historicRuns.push({
            threadId: request.threadId,
            runId: request.input.runId,
            agentId: request.agent.agentId ?? "default",
            parentRunId,
            events: compactedEvents,
            messages: Array.isArray(request.agent.messages)
              ? [...request.agent.messages]
              : [],
            createdAt: Date.now(),
          });
        }

        // Complete the run (see success-path note). Same run-id guard so a
        // superseded run's error teardown can't reset the newer run's state.
        if (store.currentRunId === request.input.runId) {
          store.currentEvents = null;
          store.currentRunId = null;
          store.agent = null;
          store.runSubject = null;
          store.stopRequested = false;
          store.isRunning = false;
        }
        runSubject.complete();
        nextSubject.complete();
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
    const store = GLOBAL_STORE.get(request.threadId);
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
    const store = GLOBAL_STORE.get(request.threadId);
    return Promise.resolve(store?.isRunning ?? false);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const store = GLOBAL_STORE.get(request.threadId);
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
    const threads: InMemoryThread[] = [];
    for (const [threadId, store] of GLOBAL_STORE) {
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
    // Most recently updated first
    return threads.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
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
    const store = GLOBAL_STORE.get(threadId);
    if (!store || store.historicRuns.length === 0) return [];
    // The last run's snapshot has the complete conversation history
    return store.historicRuns[store.historicRuns.length - 1]!.messages;
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
    const store = GLOBAL_STORE.get(threadId);
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
        if (snapshot && typeof snapshot === "object") {
          return snapshot as Record<string, unknown>;
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
    GLOBAL_STORE.clear();
  }
}
