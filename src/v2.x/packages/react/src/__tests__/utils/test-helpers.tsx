import React from "react";
import { render, act } from "@testing-library/react";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChat } from "@/components/chat/CopilotChat";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable, Subject, from, delay } from "rxjs";
import { ReactActivityMessageRenderer, ReactToolCallRenderer } from "@/types";
import { ReactCustomMessageRenderer } from "@/types/react-custom-message-renderer";

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

  clone(): MockStepwiseAgent {
    // For tests, return same instance so we can keep controlling it
    return this;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this.subject.asObservable();
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
    return this;
  }

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
    >
      <CopilotChatConfigurationProvider
        agentId={resolvedAgentId}
        threadId={resolvedThreadId}
      >
        {children || (
          <div style={{ height: 400 }}>
            <CopilotChat />
          </div>
        )}
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
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
export function textMessageContentEvent(messageId: string, delta: string): BaseEvent {
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
 * Helper to generate unique IDs for tests
 */
export function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  }
) {
  // Convert suggestions to JSON string
  const suggestionsJson = JSON.stringify({ suggestions });

  // Emit the tool call name first
  agent.emit(toolCallChunkEvent({
    toolCallId,
    toolCallName: "copilotkitSuggest",
    parentMessageId,
    delta: "",
  }));

  // Stream the JSON in chunks to simulate streaming
  const chunkSize = 10; // Characters per chunk
  for (let i = 0; i < suggestionsJson.length; i += chunkSize) {
    const chunk = suggestionsJson.substring(i, i + chunkSize);
    agent.emit(toolCallChunkEvent({
      toolCallId,
      parentMessageId,
      delta: chunk,
    }));
  }
}

/**
 * A MockStepwiseAgent that emits suggestion events when run() is called
 */
export class SuggestionsProviderAgent extends MockStepwiseAgent {
  private _suggestions: Array<{ title: string; message: string }> = [];

  setSuggestions(suggestions: Array<{ title: string; message: string }>) {
    this._suggestions = suggestions;
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
        suggestions: this._suggestions,
      });

      this.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
      this.complete();
    }, 0);

    return parentObservable;
  }
}
