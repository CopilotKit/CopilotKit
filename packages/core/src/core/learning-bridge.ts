import { createCollector } from "@copilotkit/learning";
import type {
  CaptureOptions,
  Collector,
  CollectorOptions,
  StartOptions,
} from "@copilotkit/learning";
import type { AbstractAgent, AgentSubscriber, Message } from "@ag-ui/client";
import type { CopilotKitCore } from "./core";

/** Interaction capture settings for {@link CopilotKitCore}. See `@copilotkit/learning`. */
export interface LearningConfig extends Omit<
  CollectorOptions,
  "enrich" | "capture"
> {
  /** Capture modules, plus `agentText: false` to omit message text (included in full by default). */
  capture?: CaptureOptions & { agentText?: boolean };
}

/** Returned by {@link CopilotKitCore.registerOpenThread}. */
export interface OpenThreadRegistration {
  /** The view now shows another Thread. */
  update(threadId: string): void;
  /** The view that showed this Thread is gone. */
  unregister(): void;
}

/** The part of a DOM element the enricher reads. Elements satisfy it. */
interface ClosestTarget {
  closest(
    selector: string,
  ): { getAttribute(name: string): string | null } | null;
}

interface OpenThread {
  agentId: string;
  threadId: string;
}

interface ToolCallOrigin {
  agentId: string;
  threadId: string;
  messageId: string | undefined;
  runId: string | undefined;
}

// CopilotKit's own browser traffic (Inspector telemetry and announcements) is not app activity.
const COPILOTKIT_OWN_URLS = [
  "https://telemetry.copilotkit.ai/",
  "https://cdn.copilotkit.ai/",
];

/**
 * Wires `@copilotkit/learning` into Core: agent events, the open-Thread registry,
 * and click attribution to messages and tool calls. Internal to Core.
 */
export class LearningBridge {
  private collector: Collector | null = null;
  private readonly agents = new Map<
    AbstractAgent,
    ReturnType<AbstractAgent["subscribe"]>
  >();
  private readonly openThreads = new Set<OpenThread>();
  private readonly toolCalls = new Map<string, ToolCallOrigin>();
  private readonly executingTools = new Map<string, number>();
  private readonly lastRunIds = new WeakMap<AbstractAgent, string>();
  private lastLinkedThreadId: string | null = null;
  private coreSubscription: ReturnType<CopilotKitCore["subscribe"]> | null =
    null;
  private seq = 0;
  private activeConfig: LearningConfig | undefined;

  constructor(
    private readonly core: CopilotKitCore,
    private config: LearningConfig | undefined,
  ) {
    this.setConfig(config);
  }

  setConfig(config: LearningConfig | undefined) {
    this.config = config;
    if (config === undefined) this.stop();
  }

  private startTracking() {
    if (this.coreSubscription !== null || this.trajectoryId === null) return;
    this.coreSubscription = this.core.subscribe({
      onAgentsChanged: ({ agents }) => {
        for (const agent of Object.values(agents)) this.track(agent);
      },
      // Per-thread clones are not in `core.agents`; track the running instance too.
      onAgentRunStarted: ({ agent }) => this.track(agent),
      onToolExecutionStart: ({ toolCallId, agentId, toolName }) => {
        if (this.trajectoryId === null) return;
        this.executingTools.set(toolCallId, Date.now());
        this.emitToolCall("executing", toolCallId, agentId, toolName, {});
      },
      onToolExecutionEnd: ({ toolCallId, agentId, toolName, error }) => {
        if (this.trajectoryId === null) return;
        const startedAt = this.executingTools.get(toolCallId);
        this.executingTools.delete(toolCallId);
        this.emitToolCall("completed", toolCallId, agentId, toolName, {
          durationMs:
            startedAt === undefined ? undefined : Date.now() - startedAt,
          outcome: error === undefined ? "ok" : "error",
        });
        this.toolCalls.delete(toolCallId);
      },
    });
    for (const agent of Object.values(this.core.agents)) this.track(agent);
  }

  get trajectoryId(): string | null {
    return this.collector?.trajectoryId ?? null;
  }

  start(options: StartOptions) {
    const config = this.config;
    if (config === undefined) {
      console.warn(
        "[CopilotKit] startTrajectory() needs the `learning` option on CopilotKitCore (or the CopilotKitProvider `learning` prop).",
      );
      return;
    }
    if (this.collector === null) {
      this.activeConfig = config;
      const runtimeUrl = this.core.runtimeUrl;
      this.collector = createCollector({
        ...config,
        beforeSend: (event) => {
          const sequenced = {
            ...event,
            value: { ...event.value, seq: ++this.seq },
          };
          return config.beforeSend === undefined
            ? sequenced
            : config.beforeSend(sequenced);
        },
        ignoreUrls: [
          ...(config.ignoreUrls ?? []),
          ...COPILOTKIT_OWN_URLS,
          ...(runtimeUrl === undefined ? [] : [runtimeUrl]),
        ],
        enrich: (target) => this.enrich(target),
      });
    }
    const wasActive = this.collector.trajectoryId !== null;
    this.collector.start(options);
    if (wasActive) return;
    this.startTracking();
    this.lastLinkedThreadId = null;
    for (const threadId of this.distinctOpenThreadIds())
      this.emitThreadLinked(threadId, "start");
  }

  stop() {
    this.collector?.stop();
    this.collector = null;
    this.activeConfig = undefined;
    this.coreSubscription?.unsubscribe();
    this.coreSubscription = null;
    for (const subscription of this.agents.values()) subscription.unsubscribe();
    this.agents.clear();
    this.toolCalls.clear();
    this.executingTools.clear();
  }

  /** A developer event, such as an outcome. It carries the open-Thread context unless `value` sets it. */
  emit(name: string, value: Record<string, unknown>) {
    this.collector?.emit(name, { ...this.openThreadContext(), ...value });
  }

  registerOpenThread(params: OpenThread) {
    const entry: OpenThread = { ...params };
    const isNew = !this.distinctOpenThreadIds().includes(entry.threadId);
    this.openThreads.add(entry);
    if (isNew) this.emitThreadLinked(entry.threadId, "open");
    const registration: OpenThreadRegistration = {
      update: (threadId) => {
        if (threadId === entry.threadId) return;
        entry.threadId = threadId;
        const others = [...this.openThreads].filter((other) => other !== entry);
        const isOpenElsewhere = others.some(
          (other) => other.threadId === threadId,
        );
        if (!isOpenElsewhere) this.emitThreadLinked(threadId, "switch");
      },
      unregister: () => {
        this.openThreads.delete(entry);
      },
    };
    return registration;
  }

  private distinctOpenThreadIds() {
    return [...new Set([...this.openThreads].map((open) => open.threadId))];
  }

  private emitThreadLinked(
    threadId: string,
    reason: "start" | "open" | "switch",
  ) {
    const isActive =
      this.collector !== null && this.collector.trajectoryId !== null;
    // React StrictMode unregisters and registers again in dev; one link per change is enough.
    if (!isActive || threadId === this.lastLinkedThreadId) return;
    this.lastLinkedThreadId = threadId;
    const owner = [...this.openThreads].find(
      (open) => open.threadId === threadId,
    );
    const agent = this.findAgentForThread(threadId);
    this.collector?.ɵemit("thread.linked", {
      threadId,
      agentId: owner?.agentId ?? agent?.agentId ?? null,
      hasMessages: (agent?.messages.length ?? 0) > 0,
      reason,
    });
  }

  private findAgentForThread(threadId: string) {
    return [...this.agents.keys()].find((agent) => agent.threadId === threadId);
  }

  private track(agent: AbstractAgent) {
    const agentId = agent.agentId;
    if (
      this.trajectoryId === null ||
      this.agents.has(agent) ||
      agentId === undefined
    )
      return;
    this.agents.set(
      agent,
      agent.subscribe(this.agentSubscriber(agent, agentId)),
    );
  }

  private agentSubscriber(agent: AbstractAgent, agentId: string) {
    const runIdFor = () => this.lastRunIds.get(agent);
    const subscriber: AgentSubscriber = {
      onRunStartedEvent: ({ event }) => {
        this.lastRunIds.set(agent, event.runId);
        this.emitRun("started", agent, event.threadId, event.runId);
      },
      onRunFinishedEvent: ({ event }) => {
        this.emitRun("finished", agent, event.threadId, event.runId);
      },
      onRunErrorEvent: () => {
        this.emitRun("error", agent, agent.threadId, runIdFor() ?? null);
      },
      onToolCallStartEvent: ({ event }) => {
        if (this.trajectoryId === null) return;
        const origin: ToolCallOrigin = {
          agentId,
          threadId: agent.threadId,
          messageId: event.parentMessageId,
          runId: runIdFor(),
        };
        this.toolCalls.set(event.toolCallId, origin);
        this.emitToolCall(
          "started",
          event.toolCallId,
          origin.agentId,
          event.toolCallName,
          {},
        );
      },
      onToolCallResultEvent: ({ event }) => {
        if (!this.executingTools.has(event.toolCallId)) {
          this.toolCalls.delete(event.toolCallId);
        }
      },
      onNewMessage: ({ message }) => this.emitMessage(agent, message),
    };
    return subscriber;
  }

  private emitRun(
    phase: "started" | "finished" | "error",
    agent: AbstractAgent,
    threadId: string,
    runId: string | null,
  ) {
    this.collector?.ɵemit("agent.run", {
      phase,
      runId,
      threadId,
      agentId: agent.agentId,
    });
  }

  private emitMessage(agent: AbstractAgent, message: Message) {
    // No tool names here: this fires when the text ends, before tool calls stream in.
    // `tool.call` events carry the tool name and this `messageId`.
    const content = typeof message.content === "string" ? message.content : "";
    const includeText =
      this.activeConfig?.capture?.agentText !== false &&
      typeof message.content === "string";
    this.collector?.ɵemit("agent.message", {
      messageId: message.id,
      runId: this.runIdForMessage(agent, message.id),
      threadId: agent.threadId,
      agentId: agent.agentId,
      role: message.role,
      textLength: content.length,
      ...(includeText ? { text: content } : {}),
    });
  }

  private emitToolCall(
    phase: "started" | "executing" | "completed",
    toolCallId: string,
    agentId: string,
    toolName: string,
    extra: { durationMs?: number; outcome?: "ok" | "error" },
  ) {
    const origin = this.toolCalls.get(toolCallId);
    this.collector?.ɵemit("tool.call", {
      phase,
      toolCallId,
      toolName,
      agentId,
      threadId: origin?.threadId ?? null,
      messageId: origin?.messageId,
      runId: origin?.runId,
      ...extra,
    });
  }

  private runIdForMessage(agent: AbstractAgent, messageId: string) {
    const agentId = agent.agentId;
    if (agentId === undefined) return null;
    return (
      this.core.getRunIdForMessage(agentId, agent.threadId, messageId) ??
      this.lastRunIds.get(agent) ??
      null
    );
  }

  private findMessage(messageId: string) {
    for (const agent of this.agents.keys()) {
      const message = agent.messages.find(
        (candidate) => candidate.id === messageId,
      );
      if (message !== undefined) return { agent, message };
    }
    return null;
  }

  private toolStatus(agent: AbstractAgent, toolCallId: string) {
    if (this.executingTools.has(toolCallId)) return "executing";
    const hasResult = agent.messages.some(
      (message) => message.role === "tool" && message.toolCallId === toolCallId,
    );
    return hasResult ? "complete" : "inProgress";
  }

  /** Adds agent context to a click: exact message first, then the single open Thread. */
  enrich(target: ClosestTarget) {
    const messageId =
      target.closest("[data-message-id]")?.getAttribute("data-message-id") ??
      null;
    const toolCallId =
      target
        .closest("[data-tool-call-id]")
        ?.getAttribute("data-tool-call-id") ?? null;
    const found = messageId === null ? null : this.findMessage(messageId);
    if (found !== null) {
      const { agent, message } = found;
      const toolCall =
        toolCallId !== null && message.role === "assistant"
          ? message.toolCalls?.find((call) => call.id === toolCallId)
          : undefined;
      return {
        threadId: agent.threadId,
        agentId: agent.agentId,
        messageId: message.id,
        runId: this.runIdForMessage(agent, message.id),
        ...(toolCall === undefined
          ? {}
          : {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              toolStatus: this.toolStatus(agent, toolCall.id),
            }),
      };
    }
    return this.openThreadContext();
  }

  /** The single open Thread, or `null` with the candidates when several are open. */
  private openThreadContext() {
    const openIds = this.distinctOpenThreadIds();
    if (openIds.length > 1) {
      return {
        threadId: null,
        threadAmbiguity: { reason: "multiple-open", candidates: openIds },
      };
    }
    return { threadId: openIds[0] ?? null };
  }
}
