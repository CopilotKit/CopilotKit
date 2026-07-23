import { render } from "@testing-library/vue";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { Observable, Subject, from, delay } from "rxjs";
import { defineComponent, nextTick } from "vue";
import type { Component } from "vue";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChat from "../../components/chat/CopilotChat.vue";

export class MockStepwiseAgent extends AbstractAgent {
  private readonly subject = new Subject<BaseEvent>();
  private bufferedEvents: BaseEvent[] = [];
  private bufferedComplete = false;
  private deliveryState: { chain: Promise<void> } = {
    chain: Promise.resolve(),
  };

  private enqueueDelivery(task: () => Promise<void> | void): Promise<void> {
    const run = this.deliveryState.chain.then(async () => {
      await task();
    });
    this.deliveryState.chain = run.catch(() => undefined);
    return run;
  }

  async emit(event: BaseEvent): Promise<void> {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    await this.enqueueDelivery(async () => {
      if (this.subject.observers.length === 0) {
        this.bufferedEvents.push(event);
      } else {
        this.subject.next(event);
      }
      await flushVueUpdates();
    });
  }

  async complete(): Promise<void> {
    this.isRunning = false;
    await this.enqueueDelivery(async () => {
      if (this.subject.observers.length === 0) {
        this.bufferedComplete = true;
      } else {
        this.subject.complete();
      }
      await flushVueUpdates();
    });
  }

  clone(): MockStepwiseAgent {
    const cloned = new (this.constructor as new () => MockStepwiseAgent)();
    cloned.agentId = this.agentId;
    const registry = this;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).subject = this.subject;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).bufferedEvents = this.bufferedEvents;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).bufferedComplete = this.bufferedComplete;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).deliveryState = this.deliveryState;

    Object.defineProperties(cloned, {
      threadId: {
        get() {
          return registry.threadId;
        },
        set(v: string) {
          registry.threadId = v;
        },
        configurable: true,
      },
      messages: {
        get() {
          return registry.messages;
        },
        set(v: BaseEvent[]) {
          (registry as unknown as { messages: BaseEvent[] }).messages = v;
        },
        configurable: true,
      },
      state: {
        get() {
          return registry.state;
        },
        set(v: Record<string, unknown>) {
          registry.state = v;
        },
        configurable: true,
      },
      isRunning: {
        get() {
          return registry.isRunning;
        },
        set(v: boolean) {
          registry.isRunning = v;
        },
        configurable: true,
      },
    });

    const internalKeys = new Set([
      "subject",
      "bufferedEvents",
      "bufferedComplete",
      "deliveryState",
      "agentId",
      "threadId",
      "messages",
      "state",
      "isRunning",
    ]);
    for (const key of Object.keys(registry as Record<string, unknown>)) {
      if (internalKeys.has(key)) continue;
      Object.defineProperty(cloned, key, {
        get() {
          return (registry as Record<string, unknown>)[key];
        },
        set(v: unknown) {
          (registry as Record<string, unknown>)[key] = v;
        },
        configurable: true,
      });
    }

    cloned.run = function (input: RunAgentInput): Observable<BaseEvent> {
      return registry.run(input);
    };
    cloned.emit = function (event: BaseEvent): Promise<void> {
      return registry.emit(event);
    };
    cloned.complete = function (): Promise<void> {
      return registry.complete();
    };
    return cloned;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const subscription = this.subject.subscribe(observer);
      void this.enqueueDelivery(async () => {
        if (this.bufferedEvents.length > 0) {
          for (const event of this.bufferedEvents) {
            observer.next(event);
          }
          this.bufferedEvents = [];
        }

        if (this.bufferedComplete) {
          this.bufferedComplete = false;
          observer.complete();
        }

        await flushVueUpdates();
      });
      return () => subscription.unsubscribe();
    });
  }
}

export class MockReconnectableAgent extends AbstractAgent {
  private subject = new Subject<BaseEvent>();
  private readonly storedEvents: BaseEvent[] = [];
  private bufferedEvents: BaseEvent[] = [];
  private bufferedComplete = false;
  private deliveryState: { chain: Promise<void> } = {
    chain: Promise.resolve(),
  };

  private enqueueDelivery(task: () => Promise<void> | void): Promise<void> {
    const run = this.deliveryState.chain.then(async () => {
      await task();
    });
    this.deliveryState.chain = run.catch(() => undefined);
    return run;
  }

  async emit(event: BaseEvent): Promise<void> {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    await this.enqueueDelivery(async () => {
      this.storedEvents.push(event);
      if (this.subject.observers.length === 0) {
        this.bufferedEvents.push(event);
      } else {
        this.subject.next(event);
      }
      await flushVueUpdates();
    });
  }

  async complete(): Promise<void> {
    this.isRunning = false;
    await this.enqueueDelivery(async () => {
      if (this.subject.observers.length === 0) {
        this.bufferedComplete = true;
      } else {
        this.subject.complete();
      }
      await flushVueUpdates();
    });
  }

  reset() {
    this.subject = new Subject<BaseEvent>();
    this.bufferedEvents = [];
    this.bufferedComplete = false;
    this.deliveryState = { chain: Promise.resolve() };
  }

  clone(): MockReconnectableAgent {
    const cloned = new MockReconnectableAgent();
    cloned.agentId = this.agentId;
    const registry = this;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        storedEvents: BaseEvent[];
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).subject = this.subject;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        storedEvents: BaseEvent[];
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).storedEvents = this.storedEvents;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        storedEvents: BaseEvent[];
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).bufferedEvents = this.bufferedEvents;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        storedEvents: BaseEvent[];
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).bufferedComplete = this.bufferedComplete;
    (
      cloned as unknown as {
        subject: Subject<BaseEvent>;
        storedEvents: BaseEvent[];
        bufferedEvents: BaseEvent[];
        bufferedComplete: boolean;
        deliveryState: { chain: Promise<void> };
      }
    ).deliveryState = this.deliveryState;

    Object.defineProperties(cloned, {
      threadId: {
        get() {
          return registry.threadId;
        },
        set(v: string) {
          registry.threadId = v;
        },
        configurable: true,
      },
      messages: {
        get() {
          return registry.messages;
        },
        set(v: BaseEvent[]) {
          (registry as unknown as { messages: BaseEvent[] }).messages = v;
        },
        configurable: true,
      },
      state: {
        get() {
          return registry.state;
        },
        set(v: Record<string, unknown>) {
          registry.state = v;
        },
        configurable: true,
      },
      isRunning: {
        get() {
          return registry.isRunning;
        },
        set(v: boolean) {
          registry.isRunning = v;
        },
        configurable: true,
      },
    });

    const internalKeys = new Set([
      "subject",
      "storedEvents",
      "bufferedEvents",
      "bufferedComplete",
      "deliveryState",
      "agentId",
      "threadId",
      "messages",
      "state",
      "isRunning",
    ]);
    for (const key of Object.keys(registry as Record<string, unknown>)) {
      if (internalKeys.has(key)) continue;
      Object.defineProperty(cloned, key, {
        get() {
          return (registry as Record<string, unknown>)[key];
        },
        set(v: unknown) {
          (registry as Record<string, unknown>)[key] = v;
        },
        configurable: true,
      });
    }

    cloned.run = function (input: RunAgentInput): Observable<BaseEvent> {
      return registry.run(input);
    };
    cloned.connect = function (input: RunAgentInput): Observable<BaseEvent> {
      return registry.connect(input);
    };
    cloned.emit = function (event: BaseEvent): Promise<void> {
      return registry.emit(event);
    };
    cloned.complete = function (): Promise<void> {
      return registry.complete();
    };
    return cloned;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const subscription = this.subject.subscribe(observer);
      void this.enqueueDelivery(async () => {
        if (this.bufferedEvents.length > 0) {
          for (const event of this.bufferedEvents) {
            observer.next(event);
          }
          this.bufferedEvents = [];
        }

        if (this.bufferedComplete) {
          this.bufferedComplete = false;
          observer.complete();
        }

        await flushVueUpdates();
      });
      return () => subscription.unsubscribe();
    });
  }

  connect(_input: RunAgentInput): Observable<BaseEvent> {
    return from(this.storedEvents).pipe(delay(10));
  }
}

export function renderWithCopilotKit({
  agent,
  agents,
  agentId,
  threadId,
  renderCustomMessages,
  renderActivityMessages,
  frontendTools,
  humanInTheLoop,
  children,
}: {
  agent?: AbstractAgent;
  agents?: Record<string, AbstractAgent>;
  agentId?: string;
  threadId?: string;
  renderCustomMessages?: unknown[];
  renderActivityMessages?: unknown[];
  frontendTools?: unknown[];
  humanInTheLoop?: unknown[];
  children?: Component;
}) {
  const resolvedAgentId = agentId ?? DEFAULT_AGENT_ID;
  const resolvedAgents =
    agents || (agent ? { [resolvedAgentId]: agent } : undefined);
  if (resolvedAgents) {
    for (const [id, resolvedAgent] of Object.entries(resolvedAgents)) {
      resolvedAgent.agentId = id;
    }
  }
  const resolvedThreadId = threadId ?? "test-thread";
  const childComponent = children ?? null;
  const hasChild = childComponent !== null;

  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
    },
    setup() {
      return {
        resolvedAgents,
        renderCustomMessages,
        renderActivityMessages,
        frontendTools,
        humanInTheLoop,
        resolvedAgentId,
        resolvedThreadId,
        childComponent,
        hasChild,
      };
    },
    template: `
      <CopilotKitProvider
        :agents__unsafe_dev_only="resolvedAgents"
        :render-custom-messages="renderCustomMessages"
        :render-activity-messages="renderActivityMessages"
        :frontend-tools="frontendTools"
        :human-in-the-loop="humanInTheLoop"
      >
        <CopilotChatConfigurationProvider
          :agent-id="resolvedAgentId"
          :thread-id="resolvedThreadId"
        >
          <component :is="childComponent" v-if="hasChild" />
          <div v-else style="height: 400px;">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

export function runStartedEvent(): BaseEvent {
  return { type: EventType.RUN_STARTED } as BaseEvent;
}

export function runFinishedEvent(): BaseEvent {
  return { type: EventType.RUN_FINISHED } as BaseEvent;
}

export function stateSnapshotEvent(snapshot: unknown): BaseEvent {
  return {
    type: EventType.STATE_SNAPSHOT,
    snapshot,
  } as BaseEvent;
}

// React-paired helper surface (framework-agnostic factories and scenarios).
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

export function textMessageEndEvent(messageId: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_END,
    messageId,
  } as BaseEvent;
}

export function textChunkEvent(messageId: string, delta: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    messageId,
    delta,
  } as BaseEvent;
}

export function toolCallChunkEvent(args: {
  toolCallId: string;
  toolCallName?: string;
  parentMessageId: string;
  delta: string;
}): BaseEvent {
  return {
    type: EventType.TOOL_CALL_CHUNK,
    toolCallId: args.toolCallId,
    toolCallName: args.toolCallName,
    parentMessageId: args.parentMessageId,
    delta: args.delta,
  } as BaseEvent;
}

export function toolCallResultEvent(args: {
  toolCallId: string;
  messageId: string;
  content: string;
}): BaseEvent {
  return {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: args.toolCallId,
    messageId: args.messageId,
    content: args.content,
  } as BaseEvent;
}

export function reasoningStartEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_START,
    messageId,
  } as BaseEvent;
}

export function reasoningMessageStartEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_MESSAGE_START,
    messageId,
    role: "reasoning",
  } as BaseEvent;
}

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

export function reasoningMessageEndEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_MESSAGE_END,
    messageId,
  } as BaseEvent;
}

export function reasoningEndEvent(messageId: string): BaseEvent {
  return {
    type: EventType.REASONING_END,
    messageId,
  } as BaseEvent;
}

export async function emitReasoningSequence(
  agent: MockStepwiseAgent,
  messageId: string,
  content: string,
) {
  await agent.emit(reasoningStartEvent(messageId));
  await agent.emit(reasoningMessageStartEvent(messageId));
  await agent.emit(reasoningMessageContentEvent(messageId, content));
  await agent.emit(reasoningMessageEndEvent(messageId));
  await agent.emit(reasoningEndEvent(messageId));
}

export async function emitSuggestionToolCall(
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
  const suggestionsJson = JSON.stringify({ suggestions });

  await agent.emit(
    toolCallChunkEvent({
      toolCallId,
      toolCallName: "copilotkitSuggest",
      parentMessageId,
      delta: "",
    }),
  );

  const chunkSize = 10;
  for (let i = 0; i < suggestionsJson.length; i += chunkSize) {
    const chunk = suggestionsJson.slice(i, i + chunkSize);
    await agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId,
        delta: chunk,
      }),
    );
  }
}

export class SuggestionsProviderAgent extends MockStepwiseAgent {
  private _suggestions: Array<{ title: string; message: string }> = [];

  setSuggestions(suggestions: Array<{ title: string; message: string }>) {
    this._suggestions = suggestions;
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    const parentObservable = super.run(_input);

    setTimeout(() => {
      void (async () => {
        const messageId = testId("suggest-msg");
        await this.emit({ type: EventType.RUN_STARTED } as BaseEvent);

        await emitSuggestionToolCall(this, {
          toolCallId: testId("tc"),
          parentMessageId: messageId,
          suggestions: this._suggestions,
        });

        await this.emit({ type: EventType.RUN_FINISHED } as BaseEvent);
        await this.complete();
      })();
    }, 0);

    return parentObservable;
  }
}

export function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

async function flushVueUpdates(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}
