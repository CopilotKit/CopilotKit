import {
  AgentRunner,
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "./agent-runner";
import { Observable, ReplaySubject } from "rxjs";
import {
  BaseEvent,
  Message,
  EventType,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { compactEvents } from "./event-compaction";

interface HistoricRun {
  threadId: string;
  runId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  createdAt: number;
}

class InMemoryEventStore {
  constructor(public threadId: string) {}

  /** The subject that current consumers subscribe to. */
  subject: ReplaySubject<BaseEvent> | null = null;

  /** True while a run is actively producing events. */
  isRunning = false;

  /** Lets stop() cancel the current producer. */
  abortController = new AbortController();

  /** Current run ID */
  currentRunId: string | null = null;

  /** Historic completed runs */
  historicRuns: HistoricRun[] = [];
}

const GLOBAL_STORE = new Map<string, InMemoryEventStore>();

export class InMemoryAgentRunner extends AgentRunner {
  private convertMessageToEvents(message: Message): BaseEvent[] {
    const events: BaseEvent[] = [];

    if (
      (message.role === "assistant" ||
        message.role === "user" ||
        message.role === "developer" ||
        message.role === "system") &&
      message.content
    ) {
      const textStartEvent: TextMessageStartEvent = {
        type: EventType.TEXT_MESSAGE_START,
        messageId: message.id,
        role: message.role,
      };
      events.push(textStartEvent);

      const textContentEvent: TextMessageContentEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: message.id,
        delta: message.content,
      };
      events.push(textContentEvent);

      const textEndEvent: TextMessageEndEvent = {
        type: EventType.TEXT_MESSAGE_END,
        messageId: message.id,
      };
      events.push(textEndEvent);
    }

    if (message.role === "assistant" && message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        const toolStartEvent: ToolCallStartEvent = {
          type: EventType.TOOL_CALL_START,
          toolCallId: toolCall.id,
          toolCallName: toolCall.function.name,
          parentMessageId: message.id,
        };
        events.push(toolStartEvent);

        const toolArgsEvent: ToolCallArgsEvent = {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: toolCall.id,
          delta: toolCall.function.arguments,
        };
        events.push(toolArgsEvent);

        const toolEndEvent: ToolCallEndEvent = {
          type: EventType.TOOL_CALL_END,
          toolCallId: toolCall.id,
        };
        events.push(toolEndEvent);
      }
    }

    if (message.role === "tool" && message.toolCallId) {
      const toolResultEvent: ToolCallResultEvent = {
        type: EventType.TOOL_CALL_RESULT,
        messageId: message.id,
        toolCallId: message.toolCallId,
        content: message.content,
        role: "tool",
      };
      events.push(toolResultEvent);
    }

    return events;
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    let existingStore = GLOBAL_STORE.get(request.threadId);
    if (!existingStore) {
      existingStore = new InMemoryEventStore(request.threadId);
      GLOBAL_STORE.set(request.threadId, existingStore);
    }
    const store = existingStore; // Now store is const and non-null

    if (store.isRunning) {
      throw new Error("Thread already running");
    }
    store.isRunning = true;
    store.currentRunId = request.input.runId;

    // Track seen message IDs and current run events for this run
    const seenMessageIds = new Set<string>();
    const currentRunEvents: BaseEvent[] = [];

    // Get all previously seen message IDs from historic runs
    const historicMessageIds = new Set<string>();
    for (const run of store.historicRuns) {
      for (const event of run.events) {
        if ("messageId" in event && typeof event.messageId === "string") {
          historicMessageIds.add(event.messageId);
        }
      }
    }

    const nextSubject = new ReplaySubject<BaseEvent>(Infinity);
    const prevSubject = store.subject;

    // Update the store's subject immediately
    store.subject = nextSubject;
    store.abortController = new AbortController();

    // Create a subject for run() return value
    const runSubject = new ReplaySubject<BaseEvent>(Infinity);

    // Helper function to run the agent and handle errors
    const runAgent = async () => {
      // Get parent run ID for chaining
      const lastRun = store.historicRuns[store.historicRuns.length - 1];
      const parentRunId = lastRun?.runId ?? null;

      try {
        await request.agent.runAgent(request.input, {
          onEvent: ({ event }) => {
            runSubject.next(event); // For run() return - only agent events
            nextSubject.next(event); // For connect() / store - all events
            currentRunEvents.push(event); // Accumulate for storage
          },
          onNewMessage: ({ message }) => {
            // Called for each new message
            if (!seenMessageIds.has(message.id)) {
              seenMessageIds.add(message.id);
            }
          },
          onRunStartedEvent: () => {
            // Process input messages (same logic as SQLite)
            if (request.input.messages) {
              for (const message of request.input.messages) {
                if (!seenMessageIds.has(message.id)) {
                  seenMessageIds.add(message.id);
                  const events = this.convertMessageToEvents(message);

                  // Check if this message is NEW (not in historic runs)
                  const isNewMessage = !historicMessageIds.has(message.id);

                  for (const event of events) {
                    // Always emit to stream for context
                    nextSubject.next(event);

                    // Store if this is a NEW message for this run
                    if (isNewMessage) {
                      currentRunEvents.push(event);
                    }
                  }
                }
              }
            }
          },
        });

        // Store the completed run in memory with ONLY its events
        if (store.currentRunId) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);
          store.historicRuns.push({
            threadId: request.threadId,
            runId: store.currentRunId,
            parentRunId,
            events: compactedEvents,
            createdAt: Date.now(),
          });
        }

        // Complete the run
        store.isRunning = false;
        store.currentRunId = null;
        runSubject.complete();
        nextSubject.complete();
      } catch {
        // Store the run even if it failed (partial events)
        if (store.currentRunId && currentRunEvents.length > 0) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);
          store.historicRuns.push({
            threadId: request.threadId,
            runId: store.currentRunId,
            parentRunId,
            events: compactedEvents,
            createdAt: Date.now(),
          });
        }

        // Complete the run
        store.isRunning = false;
        store.currentRunId = null;
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
    if (store.subject && store.isRunning) {
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  stop(_request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    throw new Error("Method not implemented.");
  }
}
