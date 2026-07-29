import { createHash, randomUUID } from "node:crypto";
import type { AbstractAgent, AgentSubscriber, Message } from "@ag-ui/client";
import type {
  ChannelNode,
  MessageRef,
  PlatformUser,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import type {
  CanonicalRunIdentity,
  ChannelAgentLifecycleArgs,
  ChannelAgentLoopResult,
  ConversationStore,
  AgentToolDescriptor,
  ContextEntry,
  IngressSink,
  InteractionEvent,
  NativePayload,
  PlatformAdapter,
  ReplyTarget,
  RunRenderer,
  StateStore,
  SurfaceCapabilities,
  UserQuery,
} from "@copilotkit/channels-core";
import {
  createRunRenderer as createSlackRunRenderer,
  renderSlackMessage,
} from "@copilotkit/channels-slack/render";
import {
  createRunRenderer as createTeamsRunRenderer,
  isPlainText,
  renderAdaptiveCard,
  renderTeamsMarkdown,
} from "@copilotkit/channels-teams/render";
import type {
  LiveDeliverySession,
  LiveSessionDelivery,
  LiveSessionRun,
  LiveSessionTransport,
} from "./live-session-transport.js";

interface LiveReplyTarget {
  session: LiveDeliverySession;
  delivery: LiveSessionDelivery;
}

interface LiveMessageRef extends MessageRef {
  responseId: string;
  session: LiveDeliverySession;
  adapter: "slack" | "teams";
}

export interface CanonicalChannelRunArgs {
  agent: AbstractAgent;
  threadId: string;
  runId: string;
  runnerToken: string;
  tools: readonly AgentToolDescriptor[];
  context: readonly ContextEntry[];
  persistedInputMessages: Message[];
  execute(
    subscriber: AgentSubscriber,
    canonicalRun?: CanonicalRunIdentity,
  ): Promise<ChannelAgentLoopResult>;
}

export interface LiveSessionAdapterOptions {
  transport: LiveSessionTransport;
  runCanonical(args: CanonicalChannelRunArgs): Promise<ChannelAgentLoopResult>;
  loadHistory(args: {
    threadId: string;
    appUserId: string;
  }): Promise<Message[]>;
  store?: StateStore;
  log?: (message: string, meta?: unknown) => void;
  showToolStatus?: boolean;
}

/** Typed rejection for two overlapping agent calls on one canonical thread. */
export class ChannelAgentConcurrencyError extends Error {
  readonly code = "channel_agent_concurrency_not_supported";

  constructor(threadId: string) {
    super(`Channel agent execution is already active for thread ${threadId}`);
    this.name = "ChannelAgentConcurrencyError";
  }
}

/** Managed Channels adapter backed only by Gateway-owned delivery sessions. */
export class LiveSessionAdapter implements PlatformAdapter {
  readonly platform = "intelligence";
  readonly __intelligenceChannel = true;
  readonly skipIngressDedup = true;
  readonly injectInboundTurnOnce = true;
  readonly ackDeadlineMs = 0;
  readonly stateStore?: StateStore;
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: true,
    supportsBlockingChoice: false,
    supportsEphemeral: false,
  };
  readonly conversationStore: ConversationStore = {
    seedsInboundTurn: false,
    getOrCreate: async (conversationKey, replyTarget, makeAgent) => {
      const target = asLiveTarget(replyTarget);
      const agent = makeAgent(conversationKey);
      const history = await this.options.loadHistory({
        threadId: target.delivery.canonicalThreadId,
        appUserId: target.delivery.appUserId,
      });
      agent.messages = [...history];
      this.historyIds.set(agent, new Set(history.map((message) => message.id)));
      return { agent };
    },
  };

  private sink?: IngressSink;
  private readonly rendererResponses = new WeakMap<RunRenderer, string>();
  private readonly historyIds = new WeakMap<
    AbstractAgent,
    ReadonlySet<string>
  >();
  private readonly activeThreads = new Set<string>();

  constructor(private readonly options: LiveSessionAdapterOptions) {
    this.stateStore = options.store;
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
    this.options.transport.start((session, delivery) =>
      this.dispatch(session, delivery),
    );
  }

  stop(): Promise<void> {
    return this.options.transport.stop();
  }

  private async dispatch(
    session: LiveDeliverySession,
    delivery: LiveSessionDelivery,
  ): Promise<void> {
    const sink = this.sink;
    if (!sink) throw new Error("LiveSessionAdapter is not started");
    const replyTarget: LiveReplyTarget = { session, delivery };
    const base = {
      conversationKey: delivery.canonicalThreadId,
      replyTarget,
      eventId: delivery.turn.eventId,
      turnId: delivery.turn.id,
      deliveryId: delivery.deliveryId,
      user: delivery.turn.actor
        ? {
            id: delivery.turn.actor.externalUserId,
            ...(delivery.turn.actor.displayName
              ? { name: delivery.turn.actor.displayName }
              : {}),
          }
        : undefined,
    };
    const input = delivery.turn.input;
    switch (input.kind) {
      case "text": {
        const parts = await session.getContentParts(input.files);
        await sink.onTurn({
          ...base,
          userText: input.text ?? "",
          ...(parts.length > 0
            ? {
                contentParts: [
                  ...(input.text
                    ? [{ type: "text" as const, text: input.text }]
                    : []),
                  ...parts,
                ],
              }
            : {}),
          platform: delivery.adapter,
        });
        return;
      }
      case "command":
        await sink.onCommand({
          ...base,
          command: input.command,
          text: input.text ?? "",
          ...(input.rawOptions ? { rawOptions: input.rawOptions } : {}),
          ...(input.triggerId ? { triggerId: input.triggerId } : {}),
          platform: delivery.adapter,
        });
        return;
      case "interaction":
        await sink.onInteraction({
          ...base,
          id: input.actionId,
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.messageRef ? { messageRef: input.messageRef } : {}),
          ...(input.triggerId ? { triggerId: input.triggerId } : {}),
        });
        return;
      case "reaction":
        await sink.onReaction({
          ...base,
          rawEmoji: input.rawEmoji,
          added: input.added,
          messageId: input.messageId,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          ...(input.postedRef ? { postedMessageId: input.postedRef } : {}),
          platform: delivery.adapter,
          raw: input,
        });
    }
  }

  async runAgentLifecycle(
    args: ChannelAgentLifecycleArgs,
  ): Promise<ChannelAgentLoopResult> {
    const target = asLiveTarget(args.replyTarget);
    const threadId = target.delivery.canonicalThreadId;
    if (this.activeThreads.has(threadId)) {
      throw new ChannelAgentConcurrencyError(threadId);
    }
    this.activeThreads.add(threadId);
    const responseId =
      this.rendererResponses.get(args.renderer) ?? mintId("response_");
    const callId = mintId("call_");
    let opened: LiveSessionRun | undefined;
    let status: "complete" | "failed" = "complete";
    try {
      opened = await target.session.openRun({
        callId,
        responseId,
        agentId: args.agent.agentId ?? "default",
      });
      const historyIds = this.historyIds.get(args.agent) ?? new Set<string>();
      return await this.options.runCanonical({
        agent: args.agent,
        threadId: opened.threadId,
        runId: opened.runId,
        runnerToken: opened.runnerToken,
        tools: args.tools,
        context: args.context,
        persistedInputMessages: args.agent.messages.filter(
          (message) => !historyIds.has(message.id),
        ),
        execute: args.execute,
      });
    } catch (error) {
      status = "failed";
      throw error;
    } finally {
      if (opened) {
        await target.session
          .closeRun(opened.callId, status)
          .catch((error: unknown) => {
            this.options.log?.("channel run close failed", error);
          });
      }
      this.activeThreads.delete(threadId);
    }
  }

  render(ir: ChannelNode[]): NativePayload {
    return ir;
  }

  async post(targetValue: ReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    const target = asLiveTarget(targetValue);
    const responseId = mintId("response_");
    await this.postRendered(
      target.session,
      target.delivery.adapter,
      responseId,
      ir,
    );
    return messageRef(target, responseId);
  }

  async update(refValue: MessageRef, ir: ChannelNode[]): Promise<void> {
    const ref = asLiveRef(refValue);
    await this.replaceRendered(ref.session, ref.adapter, ref.responseId, ir);
  }

  async delete(refValue: MessageRef): Promise<void> {
    const ref = asLiveRef(refValue);
    if (ref.adapter !== "slack") {
      throw new Error("Teams message delete is not supported");
    }
    await ref.session.effect(ref.responseId, {
      kind: "slack.message.delete",
    });
  }

  async stream(
    targetValue: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const target = asLiveTarget(targetValue);
    const responseId = mintId("response_");
    if (target.delivery.adapter === "slack") {
      await target.session.effect(responseId, {
        kind: "slack.stream.start",
      });
      let text = "";
      for await (const delta of chunks) {
        const before = digest(text);
        text += delta;
        await target.session.effect(responseId, {
          kind: "slack.stream.append",
          delta,
          beforeTextDigest: before,
          afterTextDigest: digest(text),
        });
      }
      await target.session.effect(responseId, {
        kind: "slack.stream.stop",
        finalTextDigest: digest(text),
      });
    } else {
      let text = "";
      let created = false;
      for await (const delta of chunks) {
        text += delta;
        await target.session.effect(responseId, {
          kind: created ? "teams.message.replace" : "teams.message.create",
          text,
        });
        created = true;
      }
    }
    return messageRef(target, responseId);
  }

  async postFile(
    targetValue: ReplyTarget,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const target = asLiveTarget(targetValue);
    if (target.delivery.adapter !== "slack") {
      return { ok: false, error: "Teams general file upload is not supported" };
    }
    try {
      const handle = await target.session.uploadFile(args);
      const responseId = mintId("response_");
      await target.session.effect(responseId, {
        kind: "slack.file.create",
        fileHandle: handle,
        ...(args.title ? { title: args.title } : {}),
        ...(args.altText ? { altText: args.altText } : {}),
      });
      return { ok: true, fileId: handle };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  createRunRenderer(targetValue: ReplyTarget): RunRenderer {
    const target = asLiveTarget(targetValue);
    const responseId = mintId("response_");
    const renderer =
      target.delivery.adapter === "slack"
        ? this.createSlackRenderer(target.session, responseId)
        : this.createTeamsRenderer(target.session, responseId);
    this.rendererResponses.set(renderer, responseId);
    return renderer;
  }

  private createSlackRenderer(
    session: LiveDeliverySession,
    responseId: string,
  ): RunRenderer {
    let text = "";
    return createSlackRunRenderer({
      target: { channel: "managed", threadTs: "managed" },
      showToolStatus: this.options.showToolStatus ?? false,
      transport: {
        setStatus: async () => undefined,
        postMessage: async ({ text: message }) => {
          await session.effect(responseId, {
            kind: "slack.message.create",
            text: message,
          });
          return { ts: responseId };
        },
        updateMessage: async ({ text: message }) => {
          await session.effect(responseId, {
            kind: "slack.message.replace",
            text: message,
          });
        },
      },
      nativeStreaming: {
        minIntervalMs: 0,
        transport: {
          startStream: async () => {
            await session.effect(responseId, {
              kind: "slack.stream.start",
            });
            return responseId;
          },
          appendText: async (_id, delta) => {
            const before = digest(text);
            text += delta;
            await session.effect(responseId, {
              kind: "slack.stream.append",
              delta,
              beforeTextDigest: before,
              afterTextDigest: digest(text),
            });
          },
          appendChunks: async (_id, chunks) => {
            for (const chunk of chunks as unknown as Array<
              Record<string, unknown>
            >) {
              if (chunk.type !== "task_update") continue;
              await session.effect(responseId, {
                kind: "slack.stream.task",
                taskId: String(chunk.id),
                title: String(chunk.title),
                status: normalizeTaskStatus(chunk.status),
              });
            }
          },
          stopStream: async () => {
            await session.effect(responseId, {
              kind: "slack.stream.stop",
              finalTextDigest: digest(text),
            });
          },
        },
      },
    });
  }

  private createTeamsRenderer(
    session: LiveDeliverySession,
    responseId: string,
  ): RunRenderer {
    return createTeamsRunRenderer({
      post: async (text) => {
        await session.effect(responseId, {
          kind: "teams.message.create",
          text,
        });
        return responseId;
      },
      update: async (_id, text) => {
        await session.effect(responseId, {
          kind: "teams.message.replace",
          text,
        });
      },
    });
  }

  private async postRendered(
    session: LiveDeliverySession,
    adapter: "slack" | "teams",
    responseId: string,
    ir: ChannelNode[],
  ): Promise<void> {
    if (adapter === "slack") {
      const rendered = renderSlackMessage(ir);
      await session.effect(responseId, {
        kind: "slack.message.create",
        text: collectText(ir),
        blocks: rendered.blocks as unknown as Array<Record<string, unknown>>,
      });
      return;
    }
    await session.effect(responseId, teamsMessageEffect("create", ir));
  }

  private async replaceRendered(
    session: LiveDeliverySession,
    adapter: "slack" | "teams",
    responseId: string,
    ir: ChannelNode[],
  ): Promise<void> {
    if (adapter === "slack") {
      const rendered = renderSlackMessage(ir);
      await session.effect(responseId, {
        kind: "slack.message.replace",
        text: collectText(ir),
        blocks: rendered.blocks as unknown as Array<Record<string, unknown>>,
      });
      return;
    }
    await session.effect(responseId, teamsMessageEffect("replace", ir));
  }

  async getMessages(targetValue: ReplyTarget): Promise<ThreadMessage[]> {
    const target = asLiveTarget(targetValue);
    const messages = await this.options.loadHistory({
      threadId: target.delivery.canonicalThreadId,
      appUserId: target.delivery.appUserId,
    });
    return messages.map((message) => ({
      text:
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      isBot: message.role !== "user",
      user: {
        id: message.role === "user" ? "user" : "bot",
        name: message.role === "user" ? "user" : "bot",
      },
    }));
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return raw as InteractionEvent;
  }

  lookupUser(_query: UserQuery): Promise<PlatformUser | undefined> {
    return Promise.resolve(undefined);
  }
}

function teamsMessageEffect(
  operation: "create" | "replace",
  ir: ChannelNode[],
) {
  const text = renderTeamsMarkdown(ir);
  return isPlainText(ir)
    ? {
        kind: `teams.message.${operation}` as const,
        text,
      }
    : {
        kind: `teams.message.${operation}` as const,
        text,
        cards: [renderAdaptiveCard(ir) as unknown as Record<string, unknown>],
      };
}

function asLiveTarget(value: ReplyTarget): LiveReplyTarget {
  const target = value as Partial<LiveReplyTarget>;
  if (!target.session || !target.delivery) {
    throw new Error("Channel reply target is outside a live delivery session");
  }
  return target as LiveReplyTarget;
}

function asLiveRef(value: MessageRef): LiveMessageRef {
  const ref = value as Partial<LiveMessageRef>;
  if (!ref.session || !ref.responseId || !ref.adapter) {
    throw new Error("Channel message ref is outside a live delivery session");
  }
  return ref as LiveMessageRef;
}

function messageRef(
  target: LiveReplyTarget,
  responseId: string,
): LiveMessageRef {
  return {
    id: responseId,
    responseId,
    session: target.session,
    adapter: target.delivery.adapter,
  };
}

function mintId(prefix: string): string {
  return `${prefix}${randomUUID().replaceAll("-", "")}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTaskStatus(
  value: unknown,
): "pending" | "in_progress" | "complete" | "failed" {
  return value === "pending" ||
    value === "in_progress" ||
    value === "complete" ||
    value === "failed"
    ? value
    : "in_progress";
}

function collectText(nodes: readonly ChannelNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.type === "text" && typeof node.props.value === "string") {
      text += node.props.value;
    }
    const children = node.props.children;
    if (Array.isArray(children)) {
      text += collectText(children as ChannelNode[]);
    }
  }
  return text;
}
