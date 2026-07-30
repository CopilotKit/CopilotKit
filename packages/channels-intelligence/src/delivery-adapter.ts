import { createHash, randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/client";
import type {
  AbstractAgent,
  AgentSubscriber,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
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
  ReplyContinuationOptions,
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
import type { ChannelProviderPayload } from "./delivery-contracts.js";
import type {
  ChannelDeliverySession,
  ChannelDeliveryTransport,
  PreparedChannelDelivery,
} from "./delivery-transport.js";
import { assertProviderReference } from "./delivery-contracts.js";
import {
  managedImageBytesMatch,
  managedImageMimeType,
} from "./delivery-files.js";

interface DeliveryReplyTarget {
  session: ChannelDeliverySession;
  delivery: PreparedChannelDelivery;
}

interface DeliveryMessageRef extends MessageRef {
  responseId: string;
  session: ChannelDeliverySession;
  adapter: "slack" | "teams";
  providerReference?: string;
}

const MANAGED_ASSET_ACTIVITY_TYPE = "copilotkit.managed-asset";

export interface CanonicalChannelRunArgs {
  agent: AbstractAgent;
  threadId: string;
  runId: string;
  userId: string;
  agentId: string;
  tools: readonly AgentToolDescriptor[];
  context: readonly ContextEntry[];
  persistedInputMessages: Message[];
  execute(
    subscriber: AgentSubscriber,
    canonicalRun?: CanonicalRunIdentity,
  ): Promise<ChannelAgentLoopResult>;
}

export interface DeliveryAdapterOptions {
  /** Declared Channel name used to own the canonical Intelligence thread. */
  channelName: string;
  transport: ChannelDeliveryTransport;
  runCanonical(args: CanonicalChannelRunArgs): Promise<ChannelAgentLoopResult>;
  loadHistory(args: {
    threadId: string;
    appUserId: string;
  }): Promise<Message[]>;
  store?: StateStore;
  log?: (message: string, meta?: unknown) => void;
  showToolStatus?: boolean;
  /** Continuation-message tuning for long Slack replies. */
  replyContinuation?: ReplyContinuationOptions;
}

/**
 * @deprecated Concurrent same-thread agent runs are supported (parallel default).
 * Kept so older importers do not break; no longer thrown by DeliveryAdapter.
 */
export class ChannelAgentConcurrencyError extends Error {
  readonly code = "channel_agent_concurrency_not_supported";

  constructor(threadId: string) {
    super(`Channel agent execution is already active for thread ${threadId}`);
    this.name = "ChannelAgentConcurrencyError";
  }
}

/** Stable managed-v1 rejection for Slack slash commands that request agent output. */
class ChannelSlashCommandAgentNotSupportedError extends Error {
  readonly code = "channel_slash_command_agent_not_supported";

  constructor() {
    super(
      "Managed Slack slash commands cannot call Thread.runAgent() in Channels v1; send a discrete reply with Thread.post() instead.",
    );
    this.name = "ChannelSlashCommandAgentNotSupportedError";
  }
}

/** Managed Channels adapter backed by the dedicated delivery boundary. */
export class DeliveryAdapter implements PlatformAdapter {
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
      const target = asDeliveryTarget(replyTarget);
      const threadId = target.delivery.canonicalThreadId;
      // Concurrent same-thread turns are allowed (channel-core parallel default).
      // makeAgent already isolates singletons via clone(); acquireAgent only
      // serializes when the same agent object is reused across runs.
      let releaseAgent: (() => void) | undefined;
      try {
        const agent = makeAgent(conversationKey);
        releaseAgent = await this.acquireAgent(agent);
        const history = await this.options.loadHistory({
          threadId,
          appUserId: target.delivery.appUserId,
        });
        agent.messages = [...history];
        this.historyIds.set(
          agent,
          new Set(history.map((message) => message.id)),
        );
        this.threadAgents.set(threadId, agent);
        let released = false;
        return {
          agent,
          release: () => {
            if (released) return;
            released = true;
            releaseAgent?.();
            if (this.threadAgents.get(threadId) === agent) {
              this.threadAgents.delete(threadId);
            }
          },
        };
      } catch (error) {
        releaseAgent?.();
        throw error;
      }
    },
  };

  private sink?: IngressSink;
  private readonly rendererResponses = new WeakMap<RunRenderer, string>();
  private readonly historyIds = new WeakMap<
    AbstractAgent,
    ReadonlySet<string>
  >();
  private readonly agentTails = new WeakMap<AbstractAgent, Promise<void>>();
  private readonly threadAgents = new Map<string, AbstractAgent>();
  private readonly activeCanonicalEvents = new Map<
    string,
    (event: BaseEvent) => Promise<void>
  >();
  private readonly interruptedRuns = new Map<string, string>();

  constructor(private readonly options: DeliveryAdapterOptions) {
    this.stateStore = options.store;
  }

  /**
   * Hold one mutable agent instance for exactly one managed canonical thread.
   *
   * Agent factories still run concurrently because they return distinct
   * objects. A configured agent instance queues here through history loading,
   * prompt injection, execution, cancellation, and finalization.
   */
  private async acquireAgent(agent: AbstractAgent): Promise<() => void> {
    const previous = this.agentTails.get(agent) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.agentTails.set(agent, tail);
    await previous;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (this.agentTails.get(agent) === tail) {
        this.agentTails.delete(agent);
      }
    };
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

  trackThreadOperation<T>(
    targetValue: ReplyTarget,
    operation: () => Promise<T>,
  ): Promise<T> {
    return asDeliveryTarget(targetValue).session.trackOperation(operation);
  }

  private async dispatch(
    session: ChannelDeliverySession,
    delivery: PreparedChannelDelivery,
  ): Promise<void> {
    const sink = this.sink;
    if (!sink) throw new Error("DeliveryAdapter is not started");
    const replyTarget: DeliveryReplyTarget = { session, delivery };
    const base = {
      conversationKey: delivery.canonicalThreadId,
      replyTarget,
      eventId: delivery.turn.eventId,
      turnId: `turn_${delivery.deliveryId.slice("dlv_".length)}`,
      deliveryId: delivery.deliveryId,
      platform: delivery.adapter,
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
        const parts = await session.getContentParts(
          input.files,
          this.options.log,
        );
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
        });
        return;
      case "interaction":
        await sink.onInteraction({
          ...base,
          id: input.actionId,
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.messageRef !== undefined
            ? {
                messageRef: inboundMessageRef(replyTarget, input.messageRef),
              }
            : {}),
          ...(input.triggerId ? { triggerId: input.triggerId } : {}),
        });
        return;
      case "reaction":
        await sink.onReaction({
          ...base,
          rawEmoji: input.rawEmoji,
          added: input.added,
          // Platform-native id for handler lookup; opaque capability stays on messageRef.
          messageId: input.messageId,
          messageRef: inboundMessageRef(replyTarget, input.messageRef),
          ...(input.postedRef ? { postedMessageId: input.postedRef } : {}),
          raw: input,
        });
        return;
      default: {
        const kind = (input as { kind?: unknown }).kind;
        throw new TypeError(
          `Unsupported prepared delivery turn kind: ${String(kind)}`,
        );
      }
    }
  }

  /** Reject managed surface-policy violations before operation tracking starts. */
  assertRunAgentSupported(targetValue: ReplyTarget): void {
    const target = asDeliveryTarget(targetValue);
    if (
      target.delivery.adapter === "slack" &&
      target.delivery.turn.input.kind === "command"
    ) {
      throw new ChannelSlashCommandAgentNotSupportedError();
    }
  }

  async runAgentLifecycle(
    args: ChannelAgentLifecycleArgs,
  ): Promise<ChannelAgentLoopResult> {
    const target = asDeliveryTarget(args.replyTarget);
    this.assertRunAgentSupported(args.replyTarget);
    const threadId = target.delivery.canonicalThreadId;
    const runId = mintId("run_");
    const historyIds = this.historyIds.get(args.agent) ?? new Set<string>();
    const persistedInputMessages = canonicalizeManagedInputMessages(
      args.agent.messages.filter((message) => !historyIds.has(message.id)),
      target.delivery.turn.input.kind === "text"
        ? target.delivery.turn.input.files
        : undefined,
    );
    const result = await this.options.runCanonical({
      agent: args.agent,
      threadId,
      runId,
      userId: target.delivery.appUserId,
      agentId: this.options.channelName,
      tools: args.tools,
      context: args.context,
      persistedInputMessages,
      execute: async (subscriber, canonicalRun) => {
        if (!canonicalRun) {
          return args.execute(subscriber, canonicalRun);
        }
        const emit = (event: BaseEvent) =>
          emitCanonicalEvent({
            agent: args.agent,
            canonicalRun,
            context: args.context,
            event,
            subscriber,
            tools: args.tools,
          });
        this.activeCanonicalEvents.set(threadId, emit);
        try {
          return await args.execute(subscriber, canonicalRun);
        } finally {
          if (this.activeCanonicalEvents.get(threadId) === emit) {
            this.activeCanonicalEvents.delete(threadId);
          }
        }
      },
    });
    if (result.interrupted) {
      this.interruptedRuns.set(threadId, runId);
    } else {
      this.interruptedRuns.delete(threadId);
    }
    if (result.deliveryError !== undefined) {
      throw result.deliveryError;
    }
    return result;
  }

  render(ir: ChannelNode[]): NativePayload {
    return ir;
  }

  async post(targetValue: ReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    const target = asDeliveryTarget(targetValue);
    const responseId = mintId("response_");
    const providerReference = await this.postRendered(
      target.session,
      target.delivery.adapter,
      responseId,
      ir,
    );
    return messageRef(target, responseId, providerReference);
  }

  async update(refValue: MessageRef, ir: ChannelNode[]): Promise<void> {
    const ref = asDeliveryRef(refValue);
    assertProviderReference(ref.providerReference);
    await this.replaceRendered(
      ref.session,
      ref.adapter,
      ref.responseId,
      ir,
      ref.providerReference,
    );
  }

  async delete(refValue: MessageRef): Promise<void> {
    const ref = asDeliveryRef(refValue);
    if (ref.adapter !== "slack") {
      throw new Error("Teams message delete is not supported");
    }
    assertProviderReference(ref.providerReference);
    await ref.session.effect(ref.responseId, {
      kind: "slack.message.delete",
      providerReference: ref.providerReference,
    });
  }

  async stream(
    targetValue: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const target = asDeliveryTarget(targetValue);
    const responseId = mintId("response_");
    let providerReference: string | undefined;
    if (target.delivery.adapter === "slack") {
      let text = "";
      let bodyError: unknown;
      let streamStarted = false;
      try {
        // Start lives inside try/finally so a missing providerReference after
        // an applied start still attempts stream.stop cleanup.
        const startResult = await target.session.effect(responseId, {
          kind: "slack.stream.start",
        });
        streamStarted = true;
        providerReference = providerReferenceFromResult(startResult);
        for await (const delta of chunks) {
          if (delta.length === 0) continue;
          const before = digest(text);
          const nextText = text + delta;
          await target.session.effect(responseId, {
            kind: "slack.stream.append",
            providerReference,
            delta,
            beforeTextDigest: before,
            afterTextDigest: digest(nextText),
          });
          // Only advance local text after the append is applied.
          text = nextText;
        }
      } catch (error) {
        bodyError = error;
        throw error;
      } finally {
        // Always stop a started stream (append failure must not leave it open).
        if (streamStarted && providerReference !== undefined) {
          try {
            await target.session.effect(responseId, {
              kind: "slack.stream.stop",
              providerReference,
              finalTextDigest: digest(text),
            });
          } catch (stopError) {
            // If the body succeeded, stop failure is the delivery failure.
            if (bodyError === undefined) throw stopError;
          }
        }
      }
    } else {
      let text = "";
      let created = false;
      for await (const delta of chunks) {
        if (delta.length === 0) continue;
        const nextText = text + delta;
        const result = created
          ? await target.session.effect(responseId, {
              kind: "teams.message.replace",
              providerReference: providerReference!,
              text: nextText,
            })
          : await target.session.effect(responseId, {
              kind: "teams.message.create",
              text: nextText,
            });
        // Only advance local text after create/replace is applied.
        text = nextText;
        providerReference ??= providerReferenceFromResult(result);
        created = true;
      }
    }
    if (!providerReference) {
      providerReference = providerReferenceFromResult(
        await target.session.effect(responseId, {
          kind:
            target.delivery.adapter === "slack"
              ? "slack.message.create"
              : "teams.message.create",
          text: "",
        }),
      );
    }
    return messageRef(target, responseId, providerReference);
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
    const target = asDeliveryTarget(targetValue);
    if (target.delivery.adapter === "teams") {
      const mimeType = managedImageMimeType(args.filename);
      if (!mimeType) {
        return {
          ok: false,
          error: "Teams general file upload is not supported",
        };
      }
      if (!managedImageBytesMatch(args.bytes, mimeType)) {
        return {
          ok: false,
          error: "Teams image bytes do not match the filename",
        };
      }
    }
    // Soft-fail only pre-effect failures (upload/config). Any session.effect
    // failure must propagate so claimAndHandle does not emit a false complete
    // terminal after a permanent provider/protocol error.
    let handle: string;
    try {
      handle = await target.session.uploadFile(args);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const responseId = mintId("response_");
    if (target.delivery.adapter === "slack") {
      await target.session.effect(responseId, {
        kind: "slack.file.create",
        fileHandle: handle,
        ...(args.title ? { title: args.title } : {}),
        ...(args.altText ? { altText: args.altText } : {}),
      });
    } else {
      await target.session.effect(responseId, {
        kind: "teams.image.create",
        fileHandle: handle,
        altText: args.altText ?? args.title ?? args.filename,
      });
    }
    await this.recordManagedAssetActivity(target, {
      assetId: handle,
      filename: args.filename,
      mimeType:
        managedImageMimeType(args.filename) ?? "application/octet-stream",
      byteSize: args.bytes.byteLength,
      ...(args.title ? { title: args.title } : {}),
      ...(args.altText ? { altText: args.altText } : {}),
    });
    return { ok: true, fileId: handle };
  }

  /** Records provider-acknowledged managed output through canonical AG-UI. */
  private async recordManagedAssetActivity(
    target: DeliveryReplyTarget,
    content: {
      readonly assetId: string;
      readonly filename: string;
      readonly mimeType: string;
      readonly byteSize: number;
      readonly title?: string;
      readonly altText?: string;
    },
  ): Promise<void> {
    const event = {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: mintId("activity_"),
      activityType: MANAGED_ASSET_ACTIVITY_TYPE,
      content,
    } as BaseEvent;
    const active = this.activeCanonicalEvents.get(
      target.delivery.canonicalThreadId,
    );
    if (active) {
      await active(event);
      return;
    }

    const agent = this.threadAgents.get(target.delivery.canonicalThreadId);
    if (!agent) {
      throw new Error(
        "Managed asset history requires an active Channel thread",
      );
    }
    await this.options.runCanonical({
      agent,
      threadId: target.delivery.canonicalThreadId,
      runId: mintId("run_"),
      userId: target.delivery.appUserId,
      agentId: this.options.channelName,
      tools: [],
      context: [],
      persistedInputMessages: [],
      execute: async (subscriber, canonicalRun) => {
        if (!canonicalRun) {
          throw new Error("Managed asset history requires a canonical run");
        }
        await emitCanonicalEvent({
          agent,
          canonicalRun,
          context: [],
          event,
          subscriber,
          tools: [],
        });
        return { iterations: 0, interrupted: false };
      },
    });
  }

  createRunRenderer(targetValue: ReplyTarget): RunRenderer {
    const target = asDeliveryTarget(targetValue);
    const responseId = mintId("response_");
    const renderer =
      target.delivery.adapter === "slack"
        ? this.createSlackRenderer(target.session, responseId)
        : this.createTeamsRenderer(target.session, responseId);
    this.rendererResponses.set(renderer, responseId);
    return renderer;
  }

  private createSlackRenderer(
    session: ChannelDeliverySession,
    responseId: string,
  ): RunRenderer {
    let text = "";
    let providerReference: string | undefined;
    return createSlackRunRenderer({
      target: { channel: "managed", threadTs: "managed" },
      showToolStatus: this.options.showToolStatus ?? false,
      transport: {
        setStatus: async () => undefined,
        postMessage: async ({ text: message }) => {
          providerReference = providerReferenceFromResult(
            await session.effect(responseId, {
              kind: "slack.message.create",
              text: message,
            }),
          );
          return { ts: responseId };
        },
        updateMessage: async ({ text: message }) => {
          assertProviderReference(providerReference);
          await session.effect(responseId, {
            kind: "slack.message.replace",
            providerReference,
            text: message,
          });
        },
      },
      nativeStreaming: {
        strict: true,
        minIntervalMs: 0,
        ...(this.options.replyContinuation !== undefined
          ? { replyContinuation: this.options.replyContinuation }
          : {}),
        transport: {
          startStream: async () => {
            providerReference = providerReferenceFromResult(
              await session.effect(responseId, {
                kind: "slack.stream.start",
              }),
            );
            return responseId;
          },
          appendText: async (_id, delta) => {
            if (delta.length === 0) return;
            assertProviderReference(providerReference);
            const before = digest(text);
            const nextText = text + delta;
            await session.effect(responseId, {
              kind: "slack.stream.append",
              providerReference,
              delta,
              beforeTextDigest: before,
              afterTextDigest: digest(nextText),
            });
            // Only advance local text after the append is applied (match stream()).
            text = nextText;
          },
          appendChunks: async (_id, chunks) => {
            assertProviderReference(providerReference);
            for (const chunk of chunks as unknown as Array<
              Record<string, unknown>
            >) {
              if (chunk.type !== "task_update") continue;
              await session.effect(responseId, {
                kind: "slack.stream.task",
                providerReference,
                taskId: String(chunk.id),
                title: String(chunk.title),
                status: normalizeTaskStatus(chunk.status),
              });
            }
          },
          stopStream: async () => {
            assertProviderReference(providerReference);
            await session.effect(responseId, {
              kind: "slack.stream.stop",
              providerReference,
              finalTextDigest: digest(text),
            });
          },
        },
      },
    });
  }

  private createTeamsRenderer(
    session: ChannelDeliverySession,
    responseId: string,
  ): RunRenderer {
    let providerReference: string | undefined;
    return createTeamsRunRenderer({
      post: async (text) => {
        providerReference = providerReferenceFromResult(
          await session.effect(responseId, {
            kind: "teams.message.create",
            text,
          }),
        );
        return responseId;
      },
      update: async (_id, text) => {
        assertProviderReference(providerReference);
        await session.effect(responseId, {
          kind: "teams.message.replace",
          providerReference,
          text,
        });
      },
    });
  }

  private async postRendered(
    session: ChannelDeliverySession,
    adapter: "slack" | "teams",
    responseId: string,
    ir: ChannelNode[],
  ): Promise<string> {
    if (adapter === "slack") {
      const rendered = renderSlackMessage(ir);
      return providerReferenceFromResult(
        await session.effect(responseId, {
          kind: "slack.message.create",
          text: collectText(ir),
          blocks: rendered.blocks as unknown as Array<Record<string, unknown>>,
        }),
      );
    }
    return providerReferenceFromResult(
      await session.effect(responseId, teamsMessageEffect("create", ir)),
    );
  }

  private async replaceRendered(
    session: ChannelDeliverySession,
    adapter: "slack" | "teams",
    responseId: string,
    ir: ChannelNode[],
    providerReference: string,
  ): Promise<void> {
    assertProviderReference(providerReference);
    if (adapter === "slack") {
      const rendered = renderSlackMessage(ir);
      await session.effect(responseId, {
        kind: "slack.message.replace",
        text: collectText(ir),
        blocks: rendered.blocks as unknown as Array<Record<string, unknown>>,
        providerReference,
      });
      return;
    }
    await session.effect(
      responseId,
      teamsMessageEffect("replace", ir, providerReference),
    );
  }

  async getMessages(targetValue: ReplyTarget): Promise<ThreadMessage[]> {
    const target = asDeliveryTarget(targetValue);
    const messages = await this.options.loadHistory({
      threadId: target.delivery.canonicalThreadId,
      appUserId: target.delivery.appUserId,
    });
    return messages.map((message) => ({
      text: historyText(message.content),
      ...(message.content !== undefined ? { content: message.content } : {}),
      ...("activityType" in message && typeof message.activityType === "string"
        ? { activityType: message.activityType }
        : {}),
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

/** Emits one canonical event through the active AgentRunner subscriber. */
async function emitCanonicalEvent(input: {
  readonly agent: AbstractAgent;
  readonly canonicalRun: CanonicalRunIdentity;
  readonly context: readonly ContextEntry[];
  readonly event: BaseEvent;
  readonly subscriber: AgentSubscriber;
  readonly tools: readonly AgentToolDescriptor[];
}): Promise<void> {
  const runInput: RunAgentInput = {
    threadId: input.canonicalRun.threadId,
    runId: input.canonicalRun.runId,
    messages: input.agent.messages,
    state: input.agent.state,
    tools: [...input.tools],
    context: [...input.context],
    forwardedProps: {},
  };
  await input.subscriber.onEvent?.({
    agent: input.agent,
    event: input.event,
    input: runInput,
    messages: input.agent.messages,
    state: input.agent.state,
  });
}

/** Replaces hydrated file bytes with durable managed-asset references. */
function canonicalizeManagedInputMessages(
  messages: Message[],
  files:
    | ReadonlyArray<{
        handle: string;
        filename: string;
        mimeType?: string;
        byteSize?: number;
      }>
    | undefined,
): Message[] {
  if (!files || files.length === 0) return messages;
  let fileIndex = 0;
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (
          typeof part !== "object" ||
          part === null ||
          !("source" in part) ||
          typeof part.source !== "object" ||
          part.source === null ||
          !("type" in part.source) ||
          part.source.type !== "data"
        ) {
          return part;
        }
        const file = files[fileIndex++];
        if (!file) return part;
        return {
          ...part,
          source: {
            type: "url" as const,
            value: `cpki-asset://${file.handle}`,
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
          },
          metadata: {
            managedAsset: {
              id: file.handle,
              filename: file.filename,
              ...(file.mimeType ? { mimeType: file.mimeType } : {}),
              ...(file.byteSize !== undefined
                ? { byteSize: file.byteSize }
                : {}),
            },
          },
        };
      }),
    } as Message;
  });
}

/** Returns human-readable text without serializing structured AG-UI content. */
function historyText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("");
}

function teamsMessageEffect(
  operation: "create" | "replace",
  ir: ChannelNode[],
  providerReference?: string,
): ChannelProviderPayload {
  const text = renderTeamsMarkdown(ir);
  const cards = isPlainText(ir)
    ? {}
    : {
        cards: [renderAdaptiveCard(ir) as unknown as Record<string, unknown>],
      };
  if (operation === "create") {
    return { kind: "teams.message.create", text, ...cards };
  }
  assertProviderReference(providerReference);
  return {
    kind: "teams.message.replace",
    providerReference,
    text,
    ...cards,
  };
}

function asDeliveryTarget(value: ReplyTarget): DeliveryReplyTarget {
  const target = value as Partial<DeliveryReplyTarget>;
  if (!target.session || !target.delivery) {
    throw new Error("Channel reply target is outside a claimed delivery");
  }
  return target as DeliveryReplyTarget;
}

function asDeliveryRef(value: MessageRef): DeliveryMessageRef {
  const ref = value as Partial<DeliveryMessageRef>;
  if (!ref.session || !ref.responseId || !ref.adapter) {
    throw new Error("Channel message ref is outside a claimed delivery");
  }
  return ref as DeliveryMessageRef;
}

function providerReferenceFromResult(result: Record<string, unknown>): string {
  const providerReference = result.providerReference;
  assertProviderReference(providerReference);
  return providerReference;
}

function messageRef(
  target: DeliveryReplyTarget,
  responseId: string,
  providerReference?: string,
): DeliveryMessageRef {
  return {
    id: providerReference ?? responseId,
    responseId,
    session: target.session,
    adapter: target.delivery.adapter,
    ...(providerReference ? { providerReference } : {}),
  };
}

/** Rehydrate a Gateway reference with delivery-local update state. */
function inboundMessageRef(
  target: DeliveryReplyTarget,
  value: unknown,
): DeliveryMessageRef {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    throw new TypeError(
      "provider message reference must contain an opaque capability",
    );
  }
  const providerReference = value.id;
  assertProviderReference(providerReference);
  return messageRef(target, mintId("response_"), providerReference);
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
