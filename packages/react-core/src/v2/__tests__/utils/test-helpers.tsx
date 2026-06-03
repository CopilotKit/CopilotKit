import React from "react";
import { render, act } from "@testing-library/react";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable, Subject, from, delay } from "rxjs";
import {
  ReactActivityMessageRenderer,
  ReactToolCallRenderer,
} from "../../types";
import { ReactCustomMessageRenderer } from "../../types/react-custom-message-renderer";

/**
 * A controllable mock agent for deterministic E2E testing.
 * Exposes emit() and complete() methods to drive agent events step-by-step.
 */
export class MockStepwiseAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();

  /**
   * Emit a single agent event
   */
  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    act(() => {
      this.subject.next(event);
    });
  }

  /**
   * Complete the agent stream
   */
  complete() {
    this.isRunning = false;
    act(() => {
      this.subject.complete();
    });
  }

  clone(): this {
    // Return a new instance that shares the same subject so tests can keep
    // controlling events via the original reference while satisfying the
    // clone() contract (must return a distinct object).
    // Use the concrete constructor so subclasses (e.g. FailingConnectAgent)
    // preserve their overridden methods.
    const cloned = new (this
      .constructor as new () => MockStepwiseAgent)() as this;
    cloned.agentId = this.agentId;
    (cloned as unknown as { subject: Subject<BaseEvent> }).subject =
      this.subject;
    return cloned;
  }

  // No-op: prevent the base class from tearing down the Subject
  // before tests have finished emitting events.
  async detachActiveRun(): Promise<void> {}

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }
}

/**
 * A tiny externally-resolvable promise. Lets a test hold a gate closed and
 * open it (resolve) / fail it (reject) at a precise moment.
 */
export class Deferred<T = void> {
  public readonly promise: Promise<T>;
  public resolve!: (value: T) => void;
  public reject!: (reason?: unknown) => void;
  private _settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = (value: T) => {
        this._settled = true;
        resolve(value);
      };
      this.reject = (reason?: unknown) => {
        this._settled = true;
        reject(reason);
      };
    });
  }

  get settled(): boolean {
    return this._settled;
  }
}

/**
 * A mock agent that reproduces the real run lifecycle's controllable timing,
 * which the Subject-based {@link MockStepwiseAgent} cannot.
 *
 * It overrides `runAgent` (the method `CopilotKitCore` / `RunHandler` await)
 * directly, rather than emitting through `run()`/a Subject. This lets a test
 * independently control:
 *   - WHEN the run "starts" (gateRunStarted) — i.e. when RUN_STARTED-equivalent
 *     side effects happen and `isRunning` flips true.
 *   - WHEN the run completes (gateCompletion) — i.e. when the `runAgent` promise
 *     resolves and the completion handle settles.
 *   - Whether the run FAILS before starting (failBeforeStart) — reproducing a
 *     pre-RUN_STARTED rejection.
 *
 * It also records the order of `runAgent` invocations and the messages present
 * at each invocation, so tests can assert serialization (no overlap) and that
 * each send's message was added before its run started.
 */
export class MockRunLifecycleAgent extends AbstractAgent {
  /** Records, in order, each runAgent invocation with a snapshot of messages. */
  public readonly runLog: Array<{
    index: number;
    messageCount: number;
    messageContents: string[];
  }> = [];

  /** Number of runAgent calls currently in flight (must never exceed 1 when serialized). */
  public concurrentRuns = 0;
  public maxConcurrentRuns = 0;

  // Per-run controllable gates. Each runAgent call shifts the next gate off
  // these queues; if none is queued, a fresh open gate is created so the run
  // proceeds immediately.
  private _startGates: Deferred[] = [];
  private _completionGates: Deferred[] = [];
  private _failBeforeStartFlags: boolean[] = [];
  private _runIndex = 0;

  /**
   * Queue a controllable lifecycle for the NEXT runAgent call.
   * Returns the gates so the test can open them at the right moment.
   */
  enqueueRun(opts?: { failBeforeStart?: boolean }): {
    gateRunStarted: Deferred;
    gateCompletion: Deferred;
  } {
    const gateRunStarted = new Deferred();
    const gateCompletion = new Deferred();
    this._startGates.push(gateRunStarted);
    this._completionGates.push(gateCompletion);
    this._failBeforeStartFlags.push(opts?.failBeforeStart ?? false);
    return { gateRunStarted, gateCompletion };
  }

  override async runAgent(): Promise<any> {
    const index = this._runIndex++;
    this.concurrentRuns++;
    this.maxConcurrentRuns = Math.max(
      this.maxConcurrentRuns,
      this.concurrentRuns,
    );

    this.runLog.push({
      index,
      messageCount: this.messages.length,
      messageContents: this.messages.map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      ),
    });

    const startGate = this._startGates.shift();
    const completionGate = this._completionGates.shift();
    const failBeforeStart = this._failBeforeStartFlags.shift() ?? false;

    try {
      if (failBeforeStart) {
        // Reject BEFORE RUN_STARTED — isRunning never flips true.
        if (startGate) await startGate.promise;
        throw new Error("run failed before RUN_STARTED");
      }

      // Wait for the test to open the start gate (or proceed immediately if
      // none was queued), then flip running on. State changes are wrapped in
      // `act()` so React flushes the resulting re-render inside an act scope —
      // exactly like MockStepwiseAgent. Tests must enable React's act
      // environment (`IS_REACT_ACT_ENVIRONMENT = true`); otherwise these
      // microtask-deferred updates leak past the test boundary and wedge the
      // renderer for subsequent tests.
      if (startGate) await startGate.promise;
      act(() => {
        this.isRunning = true;
      });

      // Hold until the test opens the completion gate.
      if (completionGate) await completionGate.promise;

      act(() => {
        this.isRunning = false;
      });
      return { newMessages: [] };
    } finally {
      this.concurrentRuns--;
    }
  }

  override clone(): this {
    const cloned = new (this
      .constructor as new () => MockRunLifecycleAgent)() as this;
    cloned.agentId = this.agentId;
    // Share mutable controller state so the test's original reference keeps
    // driving the agent even after CopilotKitCore clones it.
    const shared = this as unknown as MockRunLifecycleAgent;
    const target = cloned as unknown as MockRunLifecycleAgent;
    (target as any).runLog = shared.runLog;
    (target as any)._startGates = shared._startGates;
    (target as any)._completionGates = shared._completionGates;
    (target as any)._failBeforeStartFlags = shared._failBeforeStartFlags;
    // _runIndex / concurrency counters live on the instance actually invoked;
    // tests read them off whichever instance runs. Mirror via getters is
    // overkill — RunHandler invokes the stored agent instance directly.
    return cloned;
  }

  // No-op: there is no Subject/pipeline to tear down. Returning a resolved
  // promise also models the "clean no-op detach" the completion-gated queue
  // relies on.
  override async detachActiveRun(): Promise<void> {}

  override run(_input: RunAgentInput): Observable<BaseEvent> {
    // Not used — runAgent is overridden directly — but AbstractAgent requires it.
    return new Subject<BaseEvent>().asObservable();
  }
}

/**
 * A mock agent that supports both run() and connect() for testing reconnection scenarios.
 * On run(), emits events and stores them.
 * On connect(), replays stored events (simulating thread history replay).
 */
export class MockReconnectableAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  private storedEvents: BaseEvent[] = [];

  /**
   * Emit a single agent event during run
   */
  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    this.storedEvents.push(event);
    act(() => {
      this.subject.next(event);
    });
  }

  /**
   * Complete the agent stream
   */
  complete() {
    this.isRunning = false;
    act(() => {
      this.subject.complete();
    });
  }

  /**
   * Reset for reconnection test - creates new subject for connect
   */
  reset() {
    this.subject = new Subject<BaseEvent>();
  }

  clone(): MockReconnectableAgent {
    const cloned = new MockReconnectableAgent();
    cloned.agentId = this.agentId;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        storedEvents: BaseEvent[];
      }
    ).subject = this.subject;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        storedEvents: BaseEvent[];
      }
    ).storedEvents = this.storedEvents;
    return cloned;
  }

  // No-op: prevent the base class from tearing down the Subject
  // before tests have finished emitting events.
  async detachActiveRun(): Promise<void> {}

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
  }

  connect(_input: RunAgentInput): Observable<BaseEvent> {
    // Replay stored events with async delay to simulate HTTP transport
    // This is critical for reproducing timing bugs that occur in real scenarios
    return from(this.storedEvents).pipe(delay(10));
  }
}

/**
 * Helper to render components with CopilotKitProvider for E2E tests
 */
export function renderWithCopilotKit({
  agent,
  agents,
  renderToolCalls,
  renderCustomMessages,
  renderActivityMessages,
  frontendTools,
  humanInTheLoop,
  agentId,
  threadId,
  defaultThrottleMs,
  children,
}: {
  agent?: AbstractAgent;
  agents?: Record<string, AbstractAgent>;
  renderToolCalls?: ReactToolCallRenderer<any>[];
  renderCustomMessages?: ReactCustomMessageRenderer[];
  renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  frontendTools?: any[];
  humanInTheLoop?: any[];
  agentId?: string;
  threadId?: string;
  defaultThrottleMs?: number;
  children?: React.ReactNode;
}): ReturnType<typeof render> {
  const resolvedAgents = agents || (agent ? { default: agent } : undefined);
  const resolvedAgentId = agentId ?? DEFAULT_AGENT_ID;
  const resolvedThreadId = threadId ?? "test-thread";

  return render(
    <CopilotKitProvider
      agents__unsafe_dev_only={resolvedAgents}
      renderToolCalls={renderToolCalls}
      renderCustomMessages={renderCustomMessages}
      renderActivityMessages={renderActivityMessages}
      frontendTools={frontendTools}
      humanInTheLoop={humanInTheLoop}
      defaultThrottleMs={defaultThrottleMs}
    >
      <CopilotChatConfigurationProvider
        agentId={resolvedAgentId}
        threadId={resolvedThreadId}
      >
        {children || (
          <div style={{ height: 400 }}>
            <CopilotChat welcomeScreen={false} />
          </div>
        )}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

/**
 * Helper to create a RUN_STARTED event
 */
export function runStartedEvent(): BaseEvent {
  return { type: EventType.RUN_STARTED } as BaseEvent;
}

/**
 * Helper to create a RUN_FINISHED event
 */
export function runFinishedEvent(): BaseEvent {
  return { type: EventType.RUN_FINISHED } as BaseEvent;
}

/**
 * Helper to create a STATE_SNAPSHOT event
 */
export function stateSnapshotEvent(snapshot: unknown): BaseEvent {
  return {
    type: EventType.STATE_SNAPSHOT,
    snapshot,
  } as BaseEvent;
}

/**
 * Helper to create an ACTIVITY_SNAPSHOT event
 */
export function activitySnapshotEvent({
  messageId,
  activityType,
  content,
}: {
  messageId: string;
  activityType: string;
  content: Record<string, unknown>;
}): BaseEvent {
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId,
    activityType,
    content,
  } as BaseEvent;
}

/**
 * Helper to start an assistant text message
 */
export function textMessageStartEvent(
  messageId: string,
  role: "assistant" | "developer" | "system" | "user" = "assistant",
): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role,
  } as BaseEvent;
}

/**
 * Helper to stream text message content
 */
export function textMessageContentEvent(
  messageId: string,
  delta: string,
): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta,
  } as BaseEvent;
}

/**
 * Helper to end a text message
 */
export function textMessageEndEvent(messageId: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_END,
    messageId,
  } as BaseEvent;
}

/**
 * Helper to create a TEXT_MESSAGE_CHUNK event
 */
export function textChunkEvent(messageId: string, delta: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    messageId,
    delta,
  } as BaseEvent;
}

/**
 * Helper to create a TOOL_CALL_CHUNK event
 */
export function toolCallChunkEvent({
  toolCallId,
  toolCallName,
  parentMessageId,
  delta,
}: {
  toolCallId: string;
  toolCallName?: string;
  parentMessageId: string;
  delta: string;
}): BaseEvent {
  return {
    type: EventType.TOOL_CALL_CHUNK,
    toolCallId,
    toolCallName,
    parentMessageId,
    delta,
  } as BaseEvent;
}

/**
 * Helper to create a TOOL_CALL_RESULT event
 */
export function toolCallResultEvent({
  toolCallId,
  messageId,
  content,
}: {
  toolCallId: string;
  messageId: string;
  content: string;
}): BaseEvent {
  return {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId,
    messageId,
    content,
  } as BaseEvent;
}

/**
 * Helper to create a REASONING_START event
 */
export function reasoningStartEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_START,
    messageId,
  } as BaseEvent;
}

/**
 * Helper to create a REASONING_MESSAGE_START event
 */
export function reasoningMessageStartEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_MESSAGE_START,
    messageId,
    role: "reasoning",
  } as BaseEvent;
}

/**
 * Helper to create a REASONING_MESSAGE_CONTENT event
 */
export function reasoningMessageContentEvent(
  messageId: string,
  delta: string,
): BaseEvent {
  return {
    type: EventType.REASONING_MESSAGE_CONTENT,
    messageId,
    delta,
  } as BaseEvent;
}

/**
 * Helper to create a REASONING_MESSAGE_END event
 */
export function reasoningMessageEndEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_MESSAGE_END,
    messageId,
  } as BaseEvent;
}

/**
 * Helper to create a REASONING_END event
 */
export function reasoningEndEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_END,
    messageId,
  } as BaseEvent;
}

/**
 * Helper to emit a complete reasoning sequence (all 5 events)
 */
export function emitReasoningSequence(
  agent: MockStepwiseAgent,
  messageId: string,
  content: string,
) {
  agent.emit(reasoningStartEvent(messageId));
  agent.emit(reasoningMessageStartEvent(messageId));
  agent.emit(reasoningMessageContentEvent(messageId, content));
  agent.emit(reasoningMessageEndEvent(messageId));
  agent.emit(reasoningEndEvent(messageId));
}

/**
 * Helper to generate unique IDs for tests
 */
export function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Varied content lengths for realistic message sizes in perf tests.
const SAMPLE_ASSISTANT_TEXTS = [
  "Sure! I'd be happy to help you with that.",
  "The weather in San Francisco today is 65°F with partly cloudy skies.",
  "Here are the main points from the meeting: 1) Roadmap review, 2) Bug triage, 3) Release planning.",
  "To configure a custom agent, extend AbstractAgent and implement the run() method. Register it with CopilotKitProvider via the agents__unsafe_dev_only prop.",
  "Here is a React component that fetches data from an API endpoint using useEffect and useState.",
];

/**
 * Generate a realistic sequence of BaseEvents for N assistant messages.
 * Uses TEXT_MESSAGE_CHUNK (the only event type proven to create rendered messages
 * in jsdom tests). Every 5th message includes a tool call.
 *
 * Wrap in RUN_STARTED / RUN_FINISHED yourself if you need a full run sequence:
 * @example
 * agent.emit(runStartedEvent());
 * for (const event of generateMessages(100)) agent.emit(event);
 * agent.emit(runFinishedEvent());
 */
export function generateMessages(n: number): BaseEvent[] {
  const events: BaseEvent[] = [];

  for (let i = 0; i < n; i++) {
    const msgId = `gen-msg-${i}`;
    const text = SAMPLE_ASSISTANT_TEXTS[i % SAMPLE_ASSISTANT_TEXTS.length];

    // Stream content in ~20-char chunks to simulate real streaming
    for (let offset = 0; offset < text.length; offset += 20) {
      events.push(textChunkEvent(msgId, text.slice(offset, offset + 20)));
    }

    // Every 5th message has a tool call for realistic variety
    if (i % 5 === 4) {
      const tcId = `gen-tc-${i}`;
      const tcResult = `{"result":"tool output for message ${i}"}`;
      events.push(
        toolCallChunkEvent({
          toolCallId: tcId,
          toolCallName: "exampleTool",
          parentMessageId: msgId,
          delta: "",
        }),
      );
      events.push(
        toolCallChunkEvent({
          toolCallId: tcId,
          parentMessageId: msgId,
          delta: tcResult,
        }),
      );
      events.push(
        toolCallResultEvent({
          toolCallId: tcId,
          messageId: `${msgId}-result`,
          content: tcResult,
        }),
      );
    }
  }

  return events;
}

/**
 * Helper to emit a complete suggestion tool call with streaming chunks
 */
export function emitSuggestionToolCall(
  agent: MockStepwiseAgent,
  {
    toolCallId,
    parentMessageId,
    suggestions,
  }: {
    toolCallId: string;
    parentMessageId: string;
    suggestions: Array<{ title: string; message: string }>;
  },
) {
  // Convert suggestions to JSON string
  const suggestionsJson = JSON.stringify({ suggestions });

  // Emit the tool call name first
  agent.emit(
    toolCallChunkEvent({
      toolCallId,
      toolCallName: "copilotkitSuggest",
      parentMessageId,
      delta: "",
    }),
  );

  // Stream the JSON in chunks to simulate streaming
  const chunkSize = 10; // Characters per chunk
  for (let i = 0; i < suggestionsJson.length; i += chunkSize) {
    const chunk = suggestionsJson.substring(i, i + chunkSize);
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId,
        delta: chunk,
      }),
    );
  }
}

/**
 * A MockStepwiseAgent that emits suggestion events when run() is called
 */
export class SuggestionsProviderAgent extends MockStepwiseAgent {
  // Shared via a container so clone() and original see the same value even
  // when setSuggestions() is called after the clone is created.
  private _shared: { suggestions: Array<{ title: string; message: string }> } =
    { suggestions: [] };

  setSuggestions(suggestions: Array<{ title: string; message: string }>) {
    this._shared.suggestions = suggestions;
  }

  clone(): this {
    const cloned = super.clone();
    (cloned as unknown as { _shared: typeof this._shared })._shared =
      this._shared;
    return cloned;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    // Call the parent's run() to get the Subject that's already set up
    const parentObservable = super.run(_input);

    // Use setTimeout to emit events asynchronously through the existing subject
    setTimeout(() => {
      const messageId = testId("suggest-msg");
      this.emit({ type: EventType.RUN_STARTED } as BaseEvent);

      emitSuggestionToolCall(this, {
        toolCallId: testId("tc"),
        parentMessageId: messageId,
        suggestions: this._shared.suggestions,
      });

      this.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
      this.complete();
    }, 0);

    return parentObservable;
  }
}
