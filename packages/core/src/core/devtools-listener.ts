import { AbstractAgent, EventType } from "@ag-ui/client";
import { devtoolsClient } from "@copilotkit/devtools-client";
import type { CopilotKitDevtoolsEvents } from "@copilotkit/devtools-client";
import { randomUUID } from "@copilotkit/shared";

interface DevtoolsListenerDeps {
  getAgents: () => Readonly<Record<string, AbstractAgent>>;
}

export class DevtoolsListener {
  private deps: DevtoolsListenerDeps;
  private cleanups: (() => void)[] = [];
  private active = false;

  constructor(deps: DevtoolsListenerDeps) {
    this.deps = deps;
  }

  initialize(): void {
    this.active = true;
    this.registerHandler("tool-call", (payload) =>
      this.handleToolCall(
        payload as CopilotKitDevtoolsEvents["copilotkit:tool-call"],
      ),
    );
    this.registerHandler("text-message", (payload) =>
      this.handleTextMessage(
        payload as CopilotKitDevtoolsEvents["copilotkit:text-message"],
      ),
    );
    this.registerHandler("reasoning", (payload) =>
      this.handleReasoning(
        payload as CopilotKitDevtoolsEvents["copilotkit:reasoning"],
      ),
    );
    this.registerHandler("state-snapshot", (payload) =>
      this.handleStateSnapshot(
        payload as CopilotKitDevtoolsEvents["copilotkit:state-snapshot"],
      ),
    );
    this.registerHandler("custom-event", (payload) =>
      this.handleCustomEvent(
        payload as CopilotKitDevtoolsEvents["copilotkit:custom-event"],
      ),
    );
  }

  destroy(): void {
    // Set inactive first so any leaked listener references become no-ops
    this.active = false;
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
  }

  private registerHandler(event: string, handler: (payload: unknown) => void): void {
    // Wrap with an active-guard so that handlers registered with withEventTarget:true
    // (which may not be fully cleaned up by the EventClient's unsubscribe due to a
    // library bug with anonymous function references) become no-ops after destroy().
    const guardedHandler = (e: { payload: unknown }) => {
      if (this.active) handler(e.payload);
    };
    const unsubscribe = devtoolsClient.on(event as any, guardedHandler as any, {
      withEventTarget: true,
    } as any);
    this.cleanups.push(unsubscribe);
  }

  private makeSubscriberParams(agent: AbstractAgent, runId: string) {
    return {
      messages: agent.messages,
      state: agent.state,
      agent,
      input: {
        threadId: agent.threadId ?? "devtools-thread",
        runId,
        state: agent.state,
        messages: agent.messages,
      },
    };
  }

  private notifySubscribers(agent: AbstractAgent, cb: (sub: any) => void): void {
    for (const sub of agent.subscribers) {
      cb(sub);
    }
  }

  private withRunLifecycle(
    agent: AbstractAgent,
    runId: string,
    inner: (runParams: ReturnType<typeof this.makeSubscriberParams>) => void,
  ): void {
    const isRunning = agent.isRunning;
    const runParams = this.makeSubscriberParams(agent, runId);
    const threadId = agent.threadId ?? "devtools-thread";

    if (!isRunning) {
      this.notifySubscribers(agent, (sub) => {
        sub.onRunStartedEvent?.({
          ...runParams,
          event: { type: EventType.RUN_STARTED, threadId, runId },
        });
      });
    }

    inner(runParams);

    if (!isRunning) {
      this.notifySubscribers(agent, (sub) => {
        sub.onRunFinishedEvent?.({
          ...runParams,
          event: { type: EventType.RUN_FINISHED, threadId, runId },
        });
      });
    }
  }

  private handleToolCall(
    payload: CopilotKitDevtoolsEvents["copilotkit:tool-call"],
  ): void {
    const agent = this.deps.getAgents()[payload.agentId];
    if (!agent) return;

    const runId = randomUUID();
    const toolCallId = randomUUID();
    const argsJson = JSON.stringify(payload.args);

    this.withRunLifecycle(agent, runId, (runParams) => {
      this.notifySubscribers(agent, (sub) => {
        sub.onToolCallStartEvent?.({
          ...runParams,
          event: {
            type: EventType.TOOL_CALL_START,
            toolCallId,
            toolCallName: payload.toolName,
          },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onToolCallArgsEvent?.({
          ...runParams,
          toolCallBuffer: argsJson,
          toolCallName: payload.toolName,
          partialToolCallArgs: payload.args,
          event: {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: argsJson,
          },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onToolCallEndEvent?.({
          ...runParams,
          toolCallName: payload.toolName,
          toolCallArgs: payload.args,
          event: {
            type: EventType.TOOL_CALL_END,
            toolCallId,
          },
        });
      });

      const resultMessageId = randomUUID();
      this.notifySubscribers(agent, (sub) => {
        sub.onToolCallResultEvent?.({
          ...runParams,
          event: {
            type: EventType.TOOL_CALL_RESULT,
            toolCallId,
            messageId: resultMessageId,
            content: payload.result,
            role: "tool",
          },
        });
      });
    });
  }

  private handleTextMessage(
    payload: CopilotKitDevtoolsEvents["copilotkit:text-message"],
  ): void {
    const agent = this.deps.getAgents()[payload.agentId];
    if (!agent) return;

    const runId = randomUUID();
    const messageId = randomUUID();

    this.withRunLifecycle(agent, runId, (runParams) => {
      this.notifySubscribers(agent, (sub) => {
        sub.onTextMessageStartEvent?.({
          ...runParams,
          event: { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onTextMessageContentEvent?.({
          ...runParams,
          textMessageBuffer: payload.content,
          event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: payload.content },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onTextMessageEndEvent?.({
          ...runParams,
          textMessageBuffer: payload.content,
          event: { type: EventType.TEXT_MESSAGE_END, messageId },
        });
      });
    });
  }

  private handleReasoning(
    payload: CopilotKitDevtoolsEvents["copilotkit:reasoning"],
  ): void {
    const agent = this.deps.getAgents()[payload.agentId];
    if (!agent) return;

    const runId = randomUUID();
    const messageId = randomUUID();

    this.withRunLifecycle(agent, runId, (runParams) => {
      this.notifySubscribers(agent, (sub) => {
        sub.onReasoningStartEvent?.({
          ...runParams,
          event: { type: EventType.REASONING_START },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onReasoningMessageStartEvent?.({
          ...runParams,
          event: { type: EventType.REASONING_MESSAGE_START, messageId },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onReasoningMessageContentEvent?.({
          ...runParams,
          reasoningMessageBuffer: payload.content,
          event: { type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta: payload.content },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onReasoningMessageEndEvent?.({
          ...runParams,
          reasoningMessageBuffer: payload.content,
          event: { type: EventType.REASONING_MESSAGE_END, messageId },
        });
      });

      this.notifySubscribers(agent, (sub) => {
        sub.onReasoningEndEvent?.({
          ...runParams,
          event: { type: EventType.REASONING_END },
        });
      });
    });
  }

  private handleStateSnapshot(
    payload: CopilotKitDevtoolsEvents["copilotkit:state-snapshot"],
  ): void {
    const agent = this.deps.getAgents()[payload.agentId];
    if (!agent) return;

    const runId = randomUUID();

    this.withRunLifecycle(agent, runId, (runParams) => {
      this.notifySubscribers(agent, (sub) => {
        sub.onStateSnapshotEvent?.({
          ...runParams,
          event: { type: EventType.STATE_SNAPSHOT, snapshot: payload.state },
        });
      });
    });
  }

  private handleCustomEvent(
    payload: CopilotKitDevtoolsEvents["copilotkit:custom-event"],
  ): void {
    const agent = this.deps.getAgents()[payload.agentId];
    if (!agent) return;

    const runId = randomUUID();

    this.withRunLifecycle(agent, runId, (runParams) => {
      this.notifySubscribers(agent, (sub) => {
        sub.onCustomEvent?.({
          ...runParams,
          event: { type: EventType.CUSTOM, name: payload.name, value: payload.value },
        });
      });
    });
  }
}
